import { access, appendFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import {
  evaluateNotebookExecutionSnapshot,
  summarizeNotebookMessages,
  summarizeNotebookPod,
  summarizeNotebookTraces,
} from './notebook-execution-outcome';
import { ensureWorkspaceProjectCreatorAccess, readStoredAuthToken } from './integration-workspace-access';

export const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
export const API_BASE = process.env.INTEGRATION_API_BASE ?? 'http://localhost:20000';
export const BACKEND_REAL_ANTHROPIC_BASE_URL =
  process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ??
  'https://anthropic-compatible.provider.example/v1';
export const BACKEND_REAL_MODEL =
  process.env.BACKEND_REAL_MODEL ??
  'placeholder-model';
export const BACKEND_REAL_OPENAI_BASE_URL =
  process.env.BACKEND_REAL_OPENAI_BASE_URL ??
  'https://openai-compatible.provider.example/v1';
export const BACKEND_REAL_OPENAI_MODEL =
  process.env.BACKEND_REAL_OPENAI_MODEL ??
  BACKEND_REAL_MODEL;
const DEFAULT_REAL_MODEL_PROFILE = {
  max_context_tokens: 204800,
  max_output_tokens: 8192,
  supports_file: false,
  supports_tool_call: true,
  supports_reasoning: false,
  price_input_per_1m: 0,
  price_output_per_1m: 0,
  cache_read_discount_ratio: 0,
  cache_write_discount_ratio: 0,
} as const;
export const DOCKER_BUILD_PROXY = process.env.INTEGRATION_DOCKER_BUILD_PROXY ?? '';
export const INTERNAL_AGENT_IMAGE = process.env.INTEGRATION_INTERNAL_AGENT_IMAGE?.trim() || 'agentsmith-codex-runner:local';
export const KEYCLOAK_DEV_ADMIN_USERNAME = process.env.INTEGRATION_KEYCLOAK_USERNAME ?? 'dev-admin';
export const KEYCLOAK_DEV_ADMIN_PASSWORD = process.env.INTEGRATION_KEYCLOAK_PASSWORD ?? 'dev-admin-123';
export const KEYCLOAK_DEV_ADMIN_EMAIL = process.env.INTEGRATION_KEYCLOAK_EMAIL ?? 'dev-admin@example.com';
export const KEYCLOAK_INTEGRATION_USER_USERNAME = process.env.INTEGRATION_USER_USERNAME ?? 'integration-user';
export const KEYCLOAK_INTEGRATION_USER_PASSWORD = process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123';
export const KEYCLOAK_INTEGRATION_USER_EMAIL = process.env.INTEGRATION_USER_EMAIL ?? 'integration-user@example.com';
export const KEYCLOAK_INTEGRATION_MEMBER_USERNAME = process.env.INTEGRATION_MEMBER_USERNAME ?? 'integration-member';
export const KEYCLOAK_INTEGRATION_MEMBER_PASSWORD = process.env.INTEGRATION_MEMBER_PASSWORD ?? 'integration-member-123';
export const KEYCLOAK_INTEGRATION_MEMBER_EMAIL = process.env.INTEGRATION_MEMBER_EMAIL ?? 'integration-member@example.com';
export const KEYCLOAK_INTEGRATION_GUEST_USERNAME = process.env.INTEGRATION_GUEST_USERNAME ?? 'integration-guest';
export const KEYCLOAK_INTEGRATION_GUEST_PASSWORD = process.env.INTEGRATION_GUEST_PASSWORD ?? 'integration-guest-123';
export const KEYCLOAK_INTEGRATION_GUEST_EMAIL = process.env.INTEGRATION_GUEST_EMAIL ?? 'integration-guest@example.com';
export const KEYCLOAK_INTEGRATION_INVITEE_USERNAME = process.env.INTEGRATION_INVITEE_USERNAME ?? 'integration-invitee';
export const KEYCLOAK_INTEGRATION_INVITEE_PASSWORD = process.env.INTEGRATION_INVITEE_PASSWORD ?? 'integration-invitee-123';
export const KEYCLOAK_INTEGRATION_INVITEE_EMAIL =
  process.env.INTEGRATION_INVITEE_EMAIL ?? 'integration-invitee@example.com';
export const KEYCLOAK_DIRECTORY_CLIENT_ID = process.env.KEYCLOAK_DIRECTORY_CLIENT_ID ?? 'agentsmith-directory';
export const KEYCLOAK_DIRECTORY_CLIENT_SECRET = process.env.KEYCLOAK_DIRECTORY_CLIENT_SECRET ?? 'agentsmith-directory-secret';
export const EXTERNAL_KEYCLOAK_BASE_URL = process.env.EXTERNAL_KEYCLOAK_BASE_URL ?? 'http://localhost:18180';
export const SYSTEM_ADMIN_USERNAME = process.env.SYSTEM_ADMIN_USERNAME ?? 'mbos-admin';
export const SYSTEM_ADMIN_PASSWORD = process.env.SYSTEM_ADMIN_PASSWORD ?? 'mbos-admin';

async function collectChildPids(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn('pgrep', ['-P', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.once('error', () => resolve([]));
    child.once('close', () => {
      const pids = stdout
        .split(/\s+/)
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
      resolve(pids);
    });
  });
}

async function killProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  const children = await collectChildPids(pid);
  for (const childPid of children) {
    await killProcessTree(childPid, signal);
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

async function unmountWorkspaceTree(root: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    const mountPath = path.join(root, entry);
    await new Promise<void>((resolve) => {
      const proc = spawn('juicefs', ['umount', mountPath], { stdio: 'ignore' });
      proc.once('error', () => resolve());
      proc.once('exit', () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
  }
}

async function unmountSingleWorkspace(mountPath: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn('juicefs', ['umount', mountPath], { stdio: 'ignore' });
    proc.once('error', () => resolve());
    proc.once('exit', () => resolve());
    setTimeout(() => resolve(), 5_000);
  });
}

async function spawnAndCapture(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    proc.once('error', reject);
    proc.once('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export async function ensureIntegrationKeycloakUsers(): Promise<void> {
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await spawnAndCapture(
      'node_modules/.bin/tsx',
      ['scripts/integration-keycloak-init.ts'],
      { env: process.env },
    );
    if (result.code === 0) {
      return;
    }
    lastError = result.stderr || result.stdout;
    if (!lastError.includes('keycloak_update_realm_failed') || attempt === 2) {
      throw new Error(`integration_keycloak_init_failed:${lastError}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`integration_keycloak_init_failed:${lastError}`);
}

function withoutProxyEnv(baseEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...(baseEnv ?? process.env) };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.ALL_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  delete env.all_proxy;
  delete env.NO_PROXY;
  delete env.no_proxy;
  return env;
}

async function clearAppState(page: Page, workspaceId: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/login`);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
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

export async function keycloakLoginToWorkspace(
  page: Page,
  workspaceId: string,
  username = KEYCLOAK_DEV_ADMIN_USERNAME,
  password = KEYCLOAK_DEV_ADMIN_PASSWORD,
  options?: {
    ensureProjectCreatorAccess?: boolean;
  },
): Promise<void> {
  await clearAppState(page, workspaceId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
    await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('workspace-login__keycloak-btn').click();
    const keycloakError = page.getByTestId('workspace-login__keycloak-error');
    if (await keycloakError.isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new Error(`Keycloak login bootstrap failed: ${await keycloakError.textContent()}`);
    }

    let enteredKeycloakForm = false;
    for (let tick = 0; tick < 60; tick += 1) {
      const currentUrl = page.url();
      if (/\/realms\/.+\/protocol\/openid-connect\/auth|\/login-actions\/authenticate/i.test(currentUrl)) {
        enteredKeycloakForm = true;
        break;
      }
      if (new RegExp(`/${LOCALE}/workspaces/${workspaceId}(?:$|/login/callback|/projects|/settings)`).test(currentUrl)) {
        break;
      }
      await page.waitForTimeout(500);
    }

    if (enteredKeycloakForm) {
      await page.locator('input#username, input[name="username"], input[name="email"]').first().fill(username);
      await page.locator('input#password, input[name="password"]').first().fill(password);
      await page.locator('#kc-login, button[type="submit"]').first().click();
    }

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
      const token = await readStoredAuthToken(page);
      if (options?.ensureProjectCreatorAccess !== false) {
        await ensureWorkspaceProjectCreatorAccess({ page, apiBase: API_BASE, token, username });
      }
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects`);
      await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects(?:$|/)`), { timeout: 30_000 });
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

export async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.context().clearCookies();
  await gotoWithRetry(page, `/${LOCALE}/system/login`);
  await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-login__username').fill(SYSTEM_ADMIN_USERNAME);
  await page.getByTestId('system-login__password').fill(SYSTEM_ADMIN_PASSWORD);

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
}

async function resolveWorkspaceIdByName(page: Page, workspaceName: string): Promise<string> {
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

  if (!resolved) {
    throw new Error('workspace_id_not_found');
  }
  return resolved;
}

export async function createAndPublishWorkspaceWithDirectoryAdmin(args: {
  page: Page;
  workspaceName: string;
  keycloakBaseUrl?: string;
  keycloakRealm?: string;
  loginClientId?: string;
  directoryClientId?: string;
  directoryClientSecret?: string;
  adminEmail?: string;
}): Promise<string> {
  const keycloakBaseUrl = args.keycloakBaseUrl ?? (process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080');
  const keycloakRealm = args.keycloakRealm ?? (process.env.KEYCLOAK_REALM ?? 'mbos');
  const loginClientId = args.loginClientId ?? (process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith');
  const directoryClientId = args.directoryClientId ?? KEYCLOAK_DIRECTORY_CLIENT_ID;
  const directoryClientSecret = args.directoryClientSecret ?? KEYCLOAK_DIRECTORY_CLIENT_SECRET;
  const adminEmail = args.adminEmail ?? 'dev-admin@example.com';

  await args.page.getByTestId('system-workspaces__new-workspace').click();
  await args.page.waitForURL(new RegExp(`/${LOCALE}/system/workspaces/new$`), { timeout: 30_000 });
  await expect(args.page.getByTestId('system-workspace-create__heading')).toBeVisible({ timeout: 30_000 });
  await args.page.getByTestId('system-workspaces__draft-name').fill(args.workspaceName);
  await args.page.getByTestId('system-workspace-create__next').click();

  await args.page.getByTestId('system-workspaces__draft-idp-url').fill(keycloakBaseUrl);
  await args.page.getByTestId('system-workspaces__draft-idp-realm').fill(keycloakRealm);
  await args.page.getByTestId('system-workspaces__draft-idp-client-id').fill(loginClientId);
  await args.page.getByTestId('system-workspaces__draft-directory-client-id').fill(directoryClientId);
  await args.page.getByTestId('system-workspaces__draft-idp-client-secret').fill(directoryClientSecret);

  const verifyResponse = args.page.waitForResponse(
    (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await args.page.getByTestId('system-workspaces__verify-idp').click();
  expect((await verifyResponse).ok()).toBeTruthy();
  await expect(args.page.getByTestId('system-workspaces__idp-status')).toHaveText(/verified/i, { timeout: 20_000 });

  await args.page.getByTestId('system-workspace-create__next').click();
  await args.page.getByTestId('system-workspaces__admin-mode--directory').click();
  await selectWorkspaceAdminFromDirectory(args.page, adminEmail);

  await args.page.getByTestId('system-workspace-create__next').click();
  await args.page.getByTestId('system-workspace-create__create').click();

  const workspaceId = await resolveWorkspaceIdByName(args.page, args.workspaceName);
  await args.page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
  await args.page.getByTestId('system-workspaces__publish').click();
  await expect
    .poll(
      async () => args.page.evaluate(async (id) => {
        const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await response.json()) as {
          items?: Array<{ id: string; provisioning_status: string; last_init_error?: string | null }>;
        };
        const item = payload.items?.find((candidate) => candidate.id === id);
        return item ? `${item.provisioning_status}:${item.last_init_error ?? ''}` : 'missing';
      }, workspaceId),
      { timeout: 40_000 },
    )
    .toMatch(/^ready:/);

  return workspaceId;
}

export async function selectWorkspaceAdminFromDirectory(page: Page, email: string): Promise<void> {
  const adminInput = page.getByTestId('system-workspaces__draft-admin');
  await expect(adminInput).toBeVisible({ timeout: 15_000 });
  let lastFailure = 'directory_request_not_observed';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/system/workspaces/directory/users') &&
        candidate.request().method() === 'POST',
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
    await expect(page.getByTestId('system-workspaces__selected-admin')).toContainText(email);
    return;
  }

  throw new Error(`workspace_admin_directory_user_missing:${email}:${lastFailure}`);
}

export async function ensureWorkspaceProjectCreatorViaUi(args: {
  page: Page;
  workspaceId: string;
  creatorEmail: string;
}): Promise<void> {
  await gotoWithRetry(args.page, `/${LOCALE}/workspaces/${args.workspaceId}/settings`);
  await expect(args.page.getByTestId('ws-settings__project-creators')).toBeVisible({ timeout: 30_000 });
  const input = args.page.getByTestId('ws-settings__project-creators-input');
  await input.fill(args.creatorEmail);
  const option = args.page.getByTestId('ws-settings__project-creators-results').getByRole('button', {
    name: new RegExp(args.creatorEmail.replace('.', '\\.')),
  });
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
  await args.page.getByTestId('ws-settings__project-creators-save').click();
  await expect(args.page.getByTestId('ws-settings__project-creators-selected')).toContainText(args.creatorEmail, { timeout: 20_000 });
}

export async function ensureExternalTestKeycloak(): Promise<void> {
  const result = await spawnAndCapture('bash', ['scripts/external-keycloak-test.sh', 'up'], {
    cwd: process.cwd(),
    env: process.env,
  });
  if (result.code !== 0) {
    throw new Error(`external_keycloak_up_failed:${result.stderr || result.stdout}`);
  }
}

export async function teardownExternalTestKeycloak(): Promise<void> {
  await spawnAndCapture('bash', ['scripts/external-keycloak-test.sh', 'down'], {
    cwd: process.cwd(),
    env: process.env,
  });
}

export async function createProjectInWorkspace(
  page: Page,
  workspaceId: string,
  prefix = 'Real Integration Project',
  options?: {
    visibility?: 'public' | 'private';
    joinPolicy?: 'approval_required' | 'open';
  },
): Promise<{ projectId: string; projectName: string }> {
  const projectName = `${prefix} ${Date.now()}`;
  const token = await readStoredAuthToken(page);
  let response: Awaited<ReturnType<Page['request']['post']>> | null = null;
  let lastErrorText = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await page.request.post(`${API_BASE}/api/v1/workspaces/${workspaceId}/projects`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      data: {
        workspace_id: workspaceId,
        name: projectName,
        visibility: options?.visibility ?? 'private',
        join_policy: options?.joinPolicy ?? 'approval_required',
      },
    });
    if (response.ok()) {
      break;
    }
    lastErrorText = await response.text();
    const retryablePermissionMiss = response.status() === 403;
    const retryableConnectionReset = response.status() === 400 && lastErrorText.includes('read ECONNRESET');
    if ((!retryablePermissionMiss && !retryableConnectionReset) || attempt === 2) {
      throw new Error(`create_project_failed:${response.status()}:${lastErrorText}`);
    }
    await page.waitForTimeout(1_000 * (attempt + 1));
  }
  expect(response?.ok()).toBeTruthy();
  const created = (await response!.json()) as { id?: string };
  const projectId = created.id?.trim();
  if (!projectId) {
    throw new Error('project_id_not_found_after_create');
  }
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview`);
  await expect(page).toHaveURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/overview(?:$|\\?)`), {
    timeout: 30_000,
  });
  return { projectId, projectName };
}

export async function createCredentialViaUi(
  page: Page,
  workspaceId: string,
  projectId: string,
  credentialName: string,
  credentialValue: string,
): Promise<string> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/credentials`);
  await expect(page.getByTestId('credentials__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('credentials__create-btn').click();
  const dialog = page.getByTestId('credentials__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#cred-name').fill(credentialName);
  await dialog.locator('#cred-value').fill(credentialValue);
  const createResponse = page.waitForResponse((res) =>
    res.request().method() === 'POST'
    && new RegExp(`/api/v1/workspaces/${workspaceId}/projects/${projectId}/credentials$`).test(res.url()),
  );
  await dialog.getByRole('button', { name: /create|创建/i }).click();
  const response = await createResponse;
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const credentialId = payload?.id ?? payload?.data?.id;
  expect(credentialId).toBeTruthy();
  await expect(page.getByText(credentialName)).toBeVisible({ timeout: 30_000 });
  return credentialId!;
}

export async function createEndpointViaApi(
  page: Page,
  workspaceId: string,
  projectId: string,
  args: {
    endpointName: string;
    endpointModel: string;
    upstreamBaseUrl: string;
    credentialName: string;
    capability?: 'chat_completion' | 'multimodal_completion';
    endpointType?: 'catalog' | 'custom';
    providerFamily?: 'openai' | 'anthropic' | 'deepseek' | 'minimax' | 'kimi' | 'google' | 'glm' | 'alibaba' | 'custom';
    upstreamProtocol?: 'openai_chat_completions' | 'openai_responses' | 'anthropic_messages';
    modelProfile?: {
      max_context_tokens: number;
      max_output_tokens?: number;
      supports_file?: boolean;
      supports_tool_call?: boolean;
      supports_reasoning?: boolean;
      price_input_per_1m?: number;
      price_output_per_1m?: number;
      cache_read_discount_ratio?: number;
      cache_write_discount_ratio?: number;
    };
  },
): Promise<string> {
  const token = await readStoredAuthToken(page);
  const capability = args.capability ?? 'chat_completion';
  const modelProfile = {
    ...DEFAULT_REAL_MODEL_PROFILE,
    ...(args.modelProfile ?? {}),
  };
  const normalizedBaseUrl = args.upstreamBaseUrl.trim().toLowerCase();
  const upstreamProtocol = args.upstreamProtocol
    ?? (normalizedBaseUrl.includes('/anthropic') || normalizedBaseUrl.includes('api.anthropic.com')
      ? 'anthropic_messages'
      : 'openai_chat_completions');
  const endpointType = args.endpointType ?? 'custom';
  const providerFamily = args.providerFamily
    ?? (endpointType === 'custom'
      ? 'custom'
      : upstreamProtocol === 'anthropic_messages'
        ? 'anthropic'
        : 'openai');
  const credentialsRes = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/credentials`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(credentialsRes.ok()).toBeTruthy();
  const credentialsJson = (await credentialsRes.json().catch(() => null)) as
    | { items?: Array<{ id?: string; name?: string }> }
    | null;
  const credential = credentialsJson?.items?.find((item) => item.name === args.credentialName);
  expect(credential?.id).toBeTruthy();

  const defaults =
    capability === 'multimodal_completion'
      ? { multimodal_model_id: args.endpointModel }
      : { chat_model_id: args.endpointModel };

  const endpointRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/endpoints`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: args.endpointName,
        model: args.endpointModel,
        type: endpointType,
        base_url: args.upstreamBaseUrl,
        credential_ref: credential!.id,
        provider_family: providerFamily,
        upstream_protocol: upstreamProtocol,
        capabilities: [{ type: capability, enabled: true, default_model_id: args.endpointModel }],
        models: [{ capability, model_id: args.endpointModel, display_name: args.endpointModel }],
        defaults,
        model_profile: {
          max_context_tokens: modelProfile.max_context_tokens,
          max_output_tokens: modelProfile.max_output_tokens,
          supports_file: modelProfile.supports_file,
          supports_tool_call: modelProfile.supports_tool_call,
          supports_reasoning: modelProfile.supports_reasoning,
          price_input_per_1m: modelProfile.price_input_per_1m,
          price_output_per_1m: modelProfile.price_output_per_1m,
          cache_read_discount_ratio: modelProfile.cache_read_discount_ratio,
          cache_write_discount_ratio: modelProfile.cache_write_discount_ratio,
        },
      },
    },
  );
  expect(endpointRes.ok()).toBeTruthy();
  const endpointJson = (await endpointRes.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const endpointId = endpointJson?.id ?? endpointJson?.data?.id;
  expect(endpointId).toBeTruthy();
  return endpointId!;
}

export async function createExternalCodexAgentBundle(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    title: string;
    multimodal?: boolean;
    sessionModel?: string;
  },
): Promise<{ agentId: string; agentName: string; wsUrl: string; agentKey: string; sessionId: string }> {
  const token = await readStoredAuthToken(page);
  const agentName = `${args.title}-${Date.now()}`;
  const createAgentRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: agentName,
        mode: 'external',
        interaction_mode: 'both',
        execution_preferences: {
          chat: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: BACKEND_REAL_MODEL,
          },
          notebook: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: BACKEND_REAL_MODEL,
          },
        },
        capabilities: {
          streaming_completion: true,
          multimodal_completion: args.multimodal ?? false,
          accepted_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'text/plain'],
          max_file_count: 8,
          max_total_bytes: 62_914_560,
        },
      },
    },
  );
  expect(createAgentRes.ok()).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id: string };

  const createKeyRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents/${createdAgent.id}/keys`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    },
  );
  expect(createKeyRes.ok()).toBeTruthy();
  const keyPayload = (await createKeyRes.json()) as { key: string };

  const connectionRes = await page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents/${createdAgent.id}/connection-info`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  expect(connectionRes.ok()).toBeTruthy();
  const connectionInfo = (await connectionRes.json()) as { ws_url: string };

  const createSessionRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/chat/sessions`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        title: args.title,
        model: args.sessionModel ?? BACKEND_REAL_MODEL,
        external_agent_id: createdAgent.id,
      },
    },
  );
  expect(createSessionRes.ok()).toBeTruthy();
  const session = (await createSessionRes.json()) as { id: string };

  return {
    agentId: createdAgent.id,
    agentName,
    wsUrl: connectionInfo.ws_url.replace('ws://localhost:20000', API_BASE.replace('http://', 'ws://')),
    agentKey: keyPayload.key,
    sessionId: session.id,
  };
}

export async function createInternalCodexAgent(
  page: Page,
  args: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    title: string;
    image?: string;
    idleTimeoutSec?: number;
    maxLifetimeSec?: number;
  },
): Promise<{ agentId: string; agentName: string }> {
  const token = await readStoredAuthToken(page);
  const agentName = `${args.title}-${Date.now()}`;
  const createAgentRes = await page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/agents`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: agentName,
        mode: 'internal',
        interaction_mode: 'notebook',
        execution_preferences: {
          notebook: {
            endpoint_id: args.endpointId,
            wire_api: 'responses',
            model: BACKEND_REAL_MODEL,
          },
        },
        config: {
          image: args.image?.trim() || INTERNAL_AGENT_IMAGE,
          endpoint_id: args.endpointId,
          cpu_request: '500m',
          cpu_limit: '2',
          memory_request: '512Mi',
          memory_limit: '4Gi',
          idle_timeout_sec: args.idleTimeoutSec ?? 300,
          max_lifetime_sec: args.maxLifetimeSec ?? 3600,
        },
        capabilities: {
          streaming_completion: true,
        },
      },
    },
  );
  expect(createAgentRes.ok()).toBeTruthy();
  const createdAgent = (await createAgentRes.json()) as { id: string };
  expect(createdAgent.id).toBeTruthy();
  return {
    agentId: createdAgent.id,
    agentName,
  };
}

export function sanitizeWorkloadId(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || 'workload';
}

export async function createNotebookTaskViaApi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  agentId: string;
  fileLibraryId: string;
}): Promise<string> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks`,
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
  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`create_notebook_task_failed:${response.status()}:${body}`);
  }
  const payload = (await response.json().catch(() => null)) as { id?: string; data?: { id?: string } } | null;
  const taskId = payload?.id ?? payload?.data?.id;
  expect(taskId).toBeTruthy();
  return taskId!;
}

export async function sendTaskMessage(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  content: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
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

export async function waitForAssistantToken(args: {
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
          `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
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

type IntegrationTaskMessageSnapshot = {
  id?: string;
  role?: string;
  content?: string;
};

type IntegrationTaskTraceSnapshot = {
  id?: string;
  category?: string;
  phase?: string;
  status?: string;
  name?: string;
  summary?: string;
  at?: string;
};

type IntegrationTaskRealtimeSnapshot = {
  id?: string;
  status?: string;
  run_state?: string;
};

type WorkloadPodSnapshot = {
  name?: string | null;
  phase?: string | null;
  reason?: string | null;
  exitCode?: number | null;
};

async function fetchTaskMessagesSnapshot(args: {
  page: Page;
  authToken: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<IntegrationTaskMessageSnapshot[]> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/messages`,
    { headers: { Authorization: `Bearer ${args.authToken}` } },
  );
  if (!response.ok()) return [];
  return (await response.json().catch(() => [])) as IntegrationTaskMessageSnapshot[];
}

async function fetchTaskTracesSnapshot(args: {
  page: Page;
  authToken: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  pageSize?: number;
}): Promise<IntegrationTaskTraceSnapshot[]> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/traces?page_size=${args.pageSize ?? 100}`,
    { headers: { Authorization: `Bearer ${args.authToken}` } },
  );
  if (!response.ok()) return [];
  const payload = (await response.json().catch(() => null)) as { items?: IntegrationTaskTraceSnapshot[] } | null;
  return payload?.items ?? [];
}

async function fetchTaskRealtimeSnapshot(args: {
  page: Page;
  authToken: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<IntegrationTaskRealtimeSnapshot | null> {
  const response = await args.page.request.get(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}`,
    { headers: { Authorization: `Bearer ${args.authToken}` } },
  );
  if (!response.ok()) return null;
  return (await response.json().catch(() => null)) as IntegrationTaskRealtimeSnapshot | null;
}

async function fetchWorkloadPodSnapshot(args: {
  namespace: string;
  workloadId: string;
}): Promise<WorkloadPodSnapshot | null> {
  const result = await spawnAndCapture(
    'kubectl',
    ['get', 'pods', '-n', args.namespace, '-l', `workload_id=${args.workloadId}`, '-o', 'json'],
    { env: withoutProxyEnv(process.env) },
  );
  if (result.code !== 0) return null;
  const payload = JSON.parse(result.stdout || '{}') as {
    items?: Array<{
      metadata?: { name?: string };
      status?: {
        phase?: string;
        reason?: string;
        containerStatuses?: Array<{ state?: { terminated?: { exitCode?: number; reason?: string } } }>;
      };
    }>;
  };
  const item = payload.items?.[0];
  if (!item) return null;
  const terminated = item.status?.containerStatuses?.[0]?.state?.terminated;
  return {
    name: item.metadata?.name ?? null,
    phase: item.status?.phase ?? null,
    reason: terminated?.reason ?? item.status?.reason ?? null,
    exitCode: typeof terminated?.exitCode === 'number' ? terminated.exitCode : null,
  };
}

async function readArtifactText(artifactPath?: string): Promise<string | null> {
  if (!artifactPath) return null;
  try {
    return await (await import('node:fs/promises')).readFile(artifactPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function requestTaskWorkspaceAccess(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
}): Promise<{
  task_id: string;
  workspace_binding_mode: string;
  workspace_dir_name: string;
  file_library_id: string;
  file_library_name: string;
  filesystem_name: string;
  metadata_url: string;
  storage_bucket_url?: string;
  container_workspace_path?: string | null;
  library_root_path: string;
  recommended_mount_path?: string;
  created_at?: string;
}> {
  const authToken = await readStoredAuthToken(args.page);
  const response = await args.page.request.post(
    `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/tasks/${args.taskId}/workspace-access`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`task_workspace_access_failed:${response.status()}:${body}`);
  }
  return (await response.json()) as {
    task_id: string;
    workspace_binding_mode: string;
    workspace_dir_name: string;
    file_library_id: string;
    file_library_name: string;
    filesystem_name: string;
    metadata_url: string;
    storage_bucket_url?: string;
    container_workspace_path?: string | null;
    library_root_path: string;
    recommended_mount_path?: string;
    created_at?: string;
  };
}

export function resolveWorkspaceLibraryRootPath(input: {
  libraryRootPath?: string | null;
}): string {
  const value = input.libraryRootPath ?? '.';
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : '.';
}

export function resolveMountedTaskRoot(mountPath: string, input?: {
  libraryRootPath?: string | null;
}): string {
  const libraryRootPath = resolveWorkspaceLibraryRootPath({
    libraryRootPath: input?.libraryRootPath,
  });
  if (libraryRootPath === '.') return mountPath;
  return path.join(mountPath, libraryRootPath);
}

export function resolveLibraryObjectPath(relativePath: string, input?: {
  libraryRootPath?: string | null;
}): string {
  const libraryRootPath = resolveWorkspaceLibraryRootPath({
    libraryRootPath: input?.libraryRootPath,
  });
  if (libraryRootPath === '.') return relativePath;
  return `${libraryRootPath.replace(/^\/+|\/+$/g, '')}/${relativePath}`;
}

export async function collectInternalTaskFailureContext(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  namespace?: string;
  workloadId?: string;
  authToken?: string;
}): Promise<string> {
  const authToken = args.authToken ?? (await readStoredAuthToken(args.page));
  const [messages, traces, task, pod] = await Promise.all([
    fetchTaskMessagesSnapshot({ ...args, authToken }),
    fetchTaskTracesSnapshot({ ...args, authToken }),
    fetchTaskRealtimeSnapshot({ ...args, authToken }),
    args.namespace && args.workloadId
      ? fetchWorkloadPodSnapshot({ namespace: args.namespace, workloadId: args.workloadId })
      : Promise.resolve(null),
  ]);
  const messageSummary = summarizeNotebookMessages(messages);
  const traceSummary = summarizeNotebookTraces(traces);
  const sections = [
    `task=${args.taskId}`,
    `run_state=${task?.run_state ?? '<unknown>'}`,
    `messages:\n${messageSummary.length > 0 ? messageSummary.join('\n') : '<none>'}`,
    `traces:\n${traceSummary.length > 0 ? traceSummary.join('\n') : '<none>'}`,
    `pod=${summarizeNotebookPod(pod)}`,
  ];
  return sections.join('\n\n');
}

export async function waitForNotebookExecutionOutcome(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  token: string;
  artifactPath?: string;
  minAgentMessages?: number;
  namespace?: string;
  workloadId?: string;
  timeoutMs?: number;
}): Promise<void> {
  const authToken = await readStoredAuthToken(args.page);
  const timeoutMs = args.timeoutMs ?? 300_000;
  const startedAt = Date.now();
  let attempt = 0;
  let podSeenBefore = false;

  while (Date.now() - startedAt < timeoutMs) {
    const [messages, traces, task, artifactText, pod] = await Promise.all([
      fetchTaskMessagesSnapshot({ ...args, authToken }),
      fetchTaskTracesSnapshot({ ...args, authToken }),
      fetchTaskRealtimeSnapshot({ ...args, authToken }),
      readArtifactText(args.artifactPath),
      args.namespace && args.workloadId
        ? fetchWorkloadPodSnapshot({ namespace: args.namespace, workloadId: args.workloadId })
        : Promise.resolve(null),
    ]);

    if (pod?.name) podSeenBefore = true;

    const outcome = evaluateNotebookExecutionSnapshot({
      token: args.token,
      minAgentMessages: args.minAgentMessages,
      messages,
      traces,
      task,
      artifactContent: artifactText,
      pod,
      podSeenBefore,
    });

    if (outcome.success) return;

    if (outcome.failure) {
      const context = await collectInternalTaskFailureContext({
        page: args.page,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        taskId: args.taskId,
        namespace: args.namespace,
        workloadId: args.workloadId,
        authToken,
      });
      throw new Error(`notebook_execution_failed:${outcome.reason ?? 'unknown'}\n\n${context}`);
    }

    const intervals = [1_000, 2_000, 5_000];
    const delay = intervals[Math.min(attempt, intervals.length - 1)] ?? 5_000;
    attempt += 1;
    await args.page.waitForTimeout(delay);
  }

  const timeoutContext = await collectInternalTaskFailureContext({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    namespace: args.namespace,
    workloadId: args.workloadId,
    authToken,
  });
  throw new Error(`notebook_execution_timeout:${args.taskId}\n\n${timeoutContext}`);
}

async function readJuicefsCsiStatus(namespace: string): Promise<{
  desired: number;
  available: number;
  controllerReady: number;
  restartCountSum: number;
  nodePodsReady: boolean;
}> {
  const [daemonSet, controller, pods] = await Promise.all([
    spawnAndCapture('kubectl', ['get', 'daemonset', 'juicefs-csi-node', '-n', namespace, '-o', 'json'], {
      env: withoutProxyEnv(process.env),
    }),
    spawnAndCapture('kubectl', ['get', 'statefulset', 'juicefs-csi-controller', '-n', namespace, '-o', 'json'], {
      env: withoutProxyEnv(process.env),
    }),
    spawnAndCapture('kubectl', ['get', 'pods', '-n', namespace, '-l', 'app=juicefs-csi-node', '-o', 'json'], {
      env: withoutProxyEnv(process.env),
    }),
  ]);

  if (daemonSet.code !== 0 || controller.code !== 0 || pods.code !== 0) {
    throw new Error('juicefs_csi_status_unavailable');
  }

  const daemonSetJson = JSON.parse(daemonSet.stdout || '{}') as {
    status?: { desiredNumberScheduled?: number; numberAvailable?: number };
  };
  const controllerJson = JSON.parse(controller.stdout || '{}') as {
    status?: { readyReplicas?: number };
  };
  const podsJson = JSON.parse(pods.stdout || '{}') as {
    items?: Array<{
      status?: {
        containerStatuses?: Array<{ ready?: boolean; restartCount?: number }>;
      };
    }>;
  };

  const nodePods = podsJson.items ?? [];
  const restartCountSum = nodePods.reduce((sum, pod) => {
    return sum + (pod.status?.containerStatuses ?? []).reduce((podSum, status) => podSum + (status.restartCount ?? 0), 0);
  }, 0);
  const nodePodsReady = nodePods.length > 0 && nodePods.every((pod) => {
    const statuses = pod.status?.containerStatuses ?? [];
    return statuses.length > 0 && statuses.every((status) => status.ready === true);
  });

  return {
    desired: daemonSetJson.status?.desiredNumberScheduled ?? 0,
    available: daemonSetJson.status?.numberAvailable ?? 0,
    controllerReady: controllerJson.status?.readyReplicas ?? 0,
    restartCountSum,
    nodePodsReady,
  };
}

async function detectJuicefsCsiNamespace(): Promise<string> {
  const configuredNamespace = process.env.JUICEFS_CSI_NAMESPACE?.trim() || process.env.INTERNAL_AGENT_JUICEFS_CSI_NAMESPACE?.trim();
  if (configuredNamespace) {
    return configuredNamespace;
  }

  const [controllerNamespace, nodeNamespace] = await Promise.all([
    spawnAndCapture(
      'kubectl',
      ['get', 'statefulset', '-A', '--no-headers'],
      { env: withoutProxyEnv(process.env) },
    ),
    spawnAndCapture(
      'kubectl',
      ['get', 'daemonset', '-A', '--no-headers'],
      { env: withoutProxyEnv(process.env) },
    ),
  ]);

  const preferredNamespace = 'kube-system';
  const hasController = (controllerNamespace.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .some((line) => {
      const [namespace, name] = line.split(/\s+/);
      return namespace === preferredNamespace && name === 'juicefs-csi-controller';
    });
  if (hasController) {
    return preferredNamespace;
  }

  const hasNode = (nodeNamespace.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .some((line) => {
      const [namespace, name] = line.split(/\s+/);
      return namespace === preferredNamespace && name === 'juicefs-csi-node';
    });
  if (hasNode) {
    return preferredNamespace;
  }

  return preferredNamespace;
}

export async function waitForJuicefsCsiReady(args?: {
  namespace?: string;
  timeoutMs?: number;
  stableWindowMs?: number;
}): Promise<void> {
  const namespace = args?.namespace?.trim() || await detectJuicefsCsiNamespace();
  const timeoutMs = args?.timeoutMs ?? 180_000;
  const stableWindowMs = args?.stableWindowMs ?? 15_000;
  const startedAt = Date.now();
  let lastRestartCount: number | null = null;
  let stableSince = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await readJuicefsCsiStatus(namespace);
      const ready =
        status.desired > 0
        && status.available >= status.desired
        && status.controllerReady >= 1
        && status.nodePodsReady;

      if (ready) {
        if (lastRestartCount === status.restartCountSum) {
          if (stableSince === 0) stableSince = Date.now();
          if (Date.now() - stableSince >= stableWindowMs) {
            return;
          }
        } else {
          lastRestartCount = status.restartCountSum;
          stableSince = Date.now();
        }
      } else {
        lastRestartCount = status.restartCountSum;
        stableSince = 0;
      }
    } catch {
      stableSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const status = await readJuicefsCsiStatus(namespace).catch(() => null);
  throw new Error(
    `juicefs_csi_not_ready:${namespace}:${status ? `desired=${status.desired}:available=${status.available}:controller_ready=${status.controllerReady}:restarts=${status.restartCountSum}:node_pods_ready=${status.nodePodsReady}` : 'status_unavailable'}`,
  );
}

export async function runInternalSandboxControl(command: string): Promise<void> {
  const stateFile = process.env.INTERNAL_SANDBOX_REAL_STATE_FILE?.trim();
  if (!stateFile) {
    throw new Error('missing_INTERNAL_SANDBOX_REAL_STATE_FILE');
  }
  const result = await spawnAndCapture(
    'bash',
    ['scripts/lib/internal-sandbox-real-control.sh', command],
    {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...withoutProxyEnv(process.env),
        INTERNAL_SANDBOX_REAL_STATE_FILE: stateFile,
      },
    },
  );
  if (result.code !== 0) {
    throw new Error(`internal_sandbox_control_failed:${command}:${result.stderr || result.stdout}`);
  }
}

export async function waitForWorkloadPodPresent(args: {
  namespace: string;
  workloadId: string;
  timeoutMs?: number;
}): Promise<string> {
  let podName = '';
  await expect
    .poll(
      async () => {
        const result = await spawnAndCapture(
          'kubectl',
          [
            'get',
            'pods',
            '-n',
            args.namespace,
            '-l',
            `workload_id=${args.workloadId}`,
            '-o',
            'jsonpath={.items[0].metadata.name}',
          ],
          { env: withoutProxyEnv(process.env) },
        );
        podName = result.stdout.trim();
        return podName.length > 0 ? podName : null;
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .not.toBeNull();
  return podName;
}

export async function waitForWorkloadPodIdentity(args: {
  namespace: string;
  workloadId: string;
  timeoutMs?: number;
}): Promise<{ name: string; uid: string }> {
  let pod = { name: '', uid: '' };
  await expect
    .poll(
      async () => {
        const result = await spawnAndCapture(
          'kubectl',
          [
            'get',
            'pods',
            '-n',
            args.namespace,
            '-l',
            `workload_id=${args.workloadId}`,
            '-o',
            'jsonpath={.items[0].metadata.name}{"\\n"}{.items[0].metadata.uid}',
          ],
          { env: withoutProxyEnv(process.env) },
        );
        const [name, uid] = result.stdout
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean);
        pod = { name: name ?? '', uid: uid ?? '' };
        return pod.name && pod.uid ? pod : null;
      },
      { timeout: args.timeoutMs ?? 120_000, intervals: [1_000, 2_000, 5_000] },
    )
    .not.toBeNull();
  return pod;
}

export async function waitForWorkloadPodDeleted(args: {
  namespace: string;
  workloadId: string;
  timeoutMs?: number;
}): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await spawnAndCapture(
          'kubectl',
          [
            'get',
            'pods',
            '-n',
            args.namespace,
            '-l',
            `workload_id=${args.workloadId}`,
            '-o',
            'jsonpath={.items[*].metadata.name}',
          ],
          { env: withoutProxyEnv(process.env) },
        );
        return result.stdout.trim();
      },
      { timeout: args.timeoutMs ?? 300_000, intervals: [2_000, 5_000, 10_000] },
    )
    .toBe('');
}

export async function patchWorkloadPodExpiry(args: {
  namespace: string;
  workloadId: string;
  expiresAt: string;
}): Promise<void> {
  const podName = await waitForWorkloadPodPresent({
    namespace: args.namespace,
    workloadId: args.workloadId,
    timeoutMs: 30_000,
  });
  const result = await spawnAndCapture(
    'kubectl',
    [
      'annotate',
      'pod',
      podName,
      '-n',
      args.namespace,
      `expires_at=${args.expiresAt}`,
      '--overwrite',
    ],
    { env: withoutProxyEnv(process.env) },
  );
  if (result.code !== 0) {
    throw new Error(`patch_workload_expiry_failed:${podName}:${result.stderr || result.stdout}`);
  }
}

export async function deleteInternalWorkloadViaManager(args: {
  workspaceId: string;
  projectId: string;
  workloadId: string;
}): Promise<void> {
  const managerBase = process.env.SANDBOX_MANAGER_URL?.trim();
  const serviceKey = process.env.SANDBOX_SERVICE_KEY?.trim();
  if (!managerBase || !serviceKey) {
    throw new Error('sandbox_manager_env_missing');
  }
  const response = await fetch(
    `${managerBase.replace(/\/+$/, '')}/v1/workspaces/${encodeURIComponent(args.workspaceId)}/projects/${encodeURIComponent(args.projectId)}/workloads/${encodeURIComponent(args.workloadId)}`,
    {
      method: 'DELETE',
      headers: {
        'X-Service-Key': serviceKey,
      },
    },
  );
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => '');
    throw new Error(`delete_internal_workload_failed:${response.status}:${body}`);
  }
}

export async function waitForAgentPresenceOnline(
  page: Page,
  workspaceId: string,
  projectId: string,
  agentId: string,
): Promise<void> {
  const token = await readStoredAuthToken(page);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${API_BASE}/api/v1/workspaces/${workspaceId}/projects/${projectId}/agents/${agentId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!response.ok()) return null;
        const body = (await response.json()) as { presence?: string };
        return body.presence ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe('online');
}

export async function openChatSession(
  page: Page,
  workspaceId: string,
  projectId: string,
  expectedTitle: string,
): Promise<void> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/chat`);
  await expect(page.getByTestId('chat__main-pane')).toBeVisible({ timeout: 30_000 });
  const target = page.getByTestId('chat__thread-item').filter({ hasText: expectedTitle }).first();
  await expect(target).toBeVisible({ timeout: 30_000 });
  await target.click();
  const composer = page.getByTestId('chat__composer').locator('textarea');
  await expect(composer).toBeVisible({ timeout: 30_000 });
}

export async function startCodexRunnerProcess(args: {
  wsUrl: string;
  agentKey: string;
  codeBin?: string;
}): Promise<{
  proc: ChildProcessWithoutNullStreams;
  logPath: string;
  workspaceRoot: string;
  stop: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const logPath = path.join(tmpdir(), `agentsmith-codex-runner-${Date.now()}.log`);
    const workspaceRoot = path.join(tmpdir(), `agentsmith-codex-workspaces-${Date.now()}`);
    const builtinSkillsDir = path.resolve(__dirname, '../packages/agent-codex-runner/builtin-skills');
    const proc = spawn(
      'npm',
      ['run', 'agent:codex-runner'],
      {
        env: {
          ...process.env,
          MBOS_RUNNER_MODE: 'host_external',
          MBOS_AGENT_WS_URL: args.wsUrl,
          MBOS_AGENT_KEY: args.agentKey,
          MBOS_AGENT_CODEX_YOLO: '1',
          MBOS_AGENT_RUNNER_DEBUG: '1',
          MBOS_AGENT_WORKSPACE_ROOT: workspaceRoot,
          MBOS_AGENT_BUILTIN_SKILLS_DIR: builtinSkillsDir,
          MBOS_AGENT_BUILTIN_SKILLS: 'feishu-docs,jira-ops',
          MBOS_AGENT_BUILTIN_SKILLS_REQUIRED: '1',
          ...(args.codeBin ? { CODEX_BIN: args.codeBin } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stderr = '';
    let resolved = false;
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`codex_runner_start_timeout:${stderr.slice(-500)}:log=${logPath}`));
    }, 30_000);

    const onStdout = (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      void appendFile(logPath, text, 'utf-8');
      if (!resolved && text.includes('[agent-codex-runner] connected')) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          proc,
          logPath,
          workspaceRoot,
          stop: async () => {
            if (!proc.killed && proc.exitCode === null) {
              await killProcessTree(proc.pid, 'SIGTERM');
              await new Promise<void>((done) => {
                const killTimeout = setTimeout(() => {
                  if (!proc.killed && proc.exitCode === null) {
                    void killProcessTree(proc.pid, 'SIGKILL');
                  }
                  done();
                }, 5_000);
                proc.once('exit', () => {
                  clearTimeout(killTimeout);
                  done();
                });
              });
            }
            await unmountWorkspaceTree(workspaceRoot);
            await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
          },
        });
      }
    };

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      void appendFile(logPath, text, 'utf-8');
    });

    proc.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    proc.once('exit', (code) => {
      clearTimeout(timeout);
      if (!resolved && code !== 0) {
        reject(new Error(`codex_runner_exit_${String(code)}:${stderr.slice(-500)}:log=${logPath}`));
      }
    });

    proc.stdout.on('data', onStdout);
  });
}

export async function startCodexRunnerDockerProcess(args: {
  wsUrl: string;
  agentKey: string;
  codeBin?: string;
}): Promise<{
  containerName: string;
  workspaceRoot: string;
  imageTag: string;
  stop: () => Promise<void>;
}> {
  const baseImageTag = process.env.INTEGRATION_CODEX_RUNNER_BASE_DOCKER_IMAGE?.trim() || 'agentsmith-codex-runner-base:local';
  const imageTag = process.env.INTEGRATION_CODEX_RUNNER_DOCKER_IMAGE?.trim() || 'agentsmith-codex-runner:local';
  const embeddedRunner = process.env.INTEGRATION_CODEX_RUNNER_EMBEDDED?.trim() === '1';
  const rebuildBaseImage = process.env.INTEGRATION_CODEX_RUNNER_REBUILD_BASE_IMAGE?.trim() !== '0';
  const rebuildRunnerImage = process.env.INTEGRATION_CODEX_RUNNER_REBUILD_IMAGE?.trim() !== '0';
  const builtinSkillsList = process.env.INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS?.trim() ?? 'feishu-docs,jira-ops';
  const builtinSkillsRequired = process.env.INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_REQUIRED?.trim() ?? '1';
  const builtinSkillsDir = embeddedRunner
    ? process.env.INTEGRATION_CODEX_RUNNER_BUILTIN_SKILLS_DIR?.trim() || '/etc/codex/skills'
    : '/etc/codex/skills';
  const buildContext = path.resolve(__dirname, '..');
  const baseDockerfile = path.join(buildContext, 'infra/runner/Dockerfile.agent-codex-runner-base');
  const dockerfile = path.join(buildContext, 'infra/runner/Dockerfile.agent-codex-runner');
  if (!embeddedRunner && rebuildBaseImage) {
    const baseBuildArgs = ['build'];
    if (DOCKER_BUILD_PROXY.trim()) {
      baseBuildArgs.push('--build-arg', `HTTP_PROXY=${DOCKER_BUILD_PROXY.trim()}`);
      baseBuildArgs.push('--build-arg', `HTTPS_PROXY=${DOCKER_BUILD_PROXY.trim()}`);
      baseBuildArgs.push('--build-arg', `NO_PROXY=127.0.0.1,localhost,host.docker.internal`);
    }
    baseBuildArgs.push('-f', baseDockerfile, '-t', baseImageTag, '.');
    const baseBuildResult = await spawnAndCapture('docker', baseBuildArgs, { cwd: buildContext });
    if (baseBuildResult.code !== 0) {
      throw new Error(`docker_runner_base_image_build_failed:${baseBuildResult.stderr.slice(-800)}`);
    }
  }
  const inspectResult = await spawnAndCapture('docker', ['image', 'inspect', imageTag]);
  if (inspectResult.code !== 0 || (!embeddedRunner && rebuildRunnerImage)) {
    if (embeddedRunner) {
      throw new Error(`docker_runner_image_missing:${imageTag}`);
    }
    const buildArgs = ['build'];
    if (DOCKER_BUILD_PROXY.trim()) {
      buildArgs.push('--build-arg', `HTTP_PROXY=${DOCKER_BUILD_PROXY.trim()}`);
      buildArgs.push('--build-arg', `HTTPS_PROXY=${DOCKER_BUILD_PROXY.trim()}`);
      buildArgs.push('--build-arg', `NO_PROXY=127.0.0.1,localhost,host.docker.internal`);
    }
    buildArgs.push('--build-arg', `RUNNER_BASE_IMAGE=${baseImageTag}`);
    buildArgs.push('-f', dockerfile, '-t', imageTag, '.');
    const buildResult = await spawnAndCapture('docker', buildArgs, { cwd: buildContext });
    if (buildResult.code !== 0) {
      throw new Error(`docker_runner_image_build_failed:${buildResult.stderr.slice(-800)}`);
    }
  }

  const workspaceRoot = path.join(tmpdir(), `agentsmith-codex-docker-workspaces-${Date.now()}`);
  await mkdir(workspaceRoot, { recursive: true });
  const containerName = `agentsmith-codex-runner-${Date.now()}`;
  const requestedRunnerLogDir = process.env.INTEGRATION_RUNNER_LOG_DIR?.trim() || path.join(process.cwd(), 'test-results', 'runner-logs');
  let runnerLogDir = requestedRunnerLogDir;
  try {
    await mkdir(runnerLogDir, { recursive: true });
  } catch {
    runnerLogDir = path.join(tmpdir(), 'agentsmith-runner-logs');
    await mkdir(runnerLogDir, { recursive: true });
  }
  const writeRunnerLog = async (body: string): Promise<void> => {
    const requestedPath = path.join(runnerLogDir, `${containerName}.log`);
    try {
      await writeFile(requestedPath, body, 'utf-8');
      return;
    } catch {
      const fallbackDir = path.join(tmpdir(), 'agentsmith-runner-logs');
      await mkdir(fallbackDir, { recursive: true });
      const fallbackPath = path.join(fallbackDir, `${containerName}.log`);
      await writeFile(fallbackPath, body, 'utf-8');
      console.warn(`[integration-real-helpers] runner log fallback: ${requestedPath} -> ${fallbackPath}`);
    }
  };
  const preserveRunnerLogs = async (): Promise<void> => {
    const logs = await spawnAndCapture('docker', ['logs', containerName]).catch(() => ({
      code: 1,
      stdout: '',
      stderr: '',
    }));
    const logBody = `${logs.stdout}${logs.stdout && logs.stderr ? '\n' : ''}${logs.stderr}`.trim();
    if (logBody.length > 0) {
      await writeRunnerLog(`${logBody}\n`);
    } else {
      await writeRunnerLog('[runner log unavailable]\n');
    }
  };
  const runArgs = [
    'run',
    '--detach',
    '--name',
    containerName,
    '--network',
    'host',
    '--add-host',
    'host.docker.internal:host-gateway',
    '--privileged',
    '--device',
    '/dev/fuse',
    '--security-opt',
    'apparmor:unconfined',
    '--env',
    'MBOS_RUNNER_MODE=docker_external',
    '--env',
    `MBOS_AGENT_WS_URL=${args.wsUrl}`,
    '--env',
    `MBOS_AGENT_KEY=${args.agentKey}`,
    '--env',
    'MBOS_AGENT_CODEX_YOLO=1',
    '--env',
    'MBOS_AGENT_RUNNER_DEBUG=1',
    '--env',
    `MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS=${process.env.INTEGRATION_CODEX_RUNNER_MOUNT_READY_TIMEOUT_MS?.trim() || '120000'}`,
    '--env',
    'MBOS_AGENT_WORKSPACE_ROOT=/workspace',
    '--env',
    `MBOS_AGENT_BUILTIN_SKILLS_DIR=${builtinSkillsDir}`,
    '--env',
    `MBOS_AGENT_BUILTIN_SKILLS=${builtinSkillsList}`,
    '--env',
    `MBOS_AGENT_BUILTIN_SKILLS_REQUIRED=${builtinSkillsRequired}`,
    '--volume',
    `${workspaceRoot}:/workspace:rshared`,
  ];
  if (args.codeBin) {
    runArgs.push('--env', `CODEX_BIN=${args.codeBin}`);
  }
  if (!embeddedRunner) {
    runArgs.push('--volume', `${buildContext}:/app`);
  }
  runArgs.push(imageTag);

  const runResult = await spawnAndCapture('docker', runArgs);
  if (runResult.code !== 0) {
    throw new Error(`docker_runner_start_failed:${runResult.stderr.slice(-800)}`);
  }

  const started = (runResult.stdout || '').trim();
  if (!started) {
    throw new Error('docker_runner_start_missing_container_id');
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const logs = await spawnAndCapture('docker', ['logs', containerName]);
    if (`${logs.stdout}\n${logs.stderr}`.includes('[agent-codex-runner] connected')) {
      await preserveRunnerLogs();
      return {
        containerName,
        workspaceRoot,
        imageTag,
        stop: async () => {
          await preserveRunnerLogs();
          await spawnAndCapture('docker', ['rm', '-f', containerName]);
          await unmountWorkspaceTree(workspaceRoot);
          await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
        },
      };
    }
    const inspectRunning = await spawnAndCapture('docker', ['inspect', '-f', '{{.State.Running}}', containerName]);
    if (inspectRunning.code !== 0 || !inspectRunning.stdout.includes('true')) {
      await preserveRunnerLogs();
      const inspectDetails = await spawnAndCapture('docker', [
        'inspect',
        '-f',
        'running={{.State.Running}} exit={{.State.ExitCode}} error={{.State.Error}} oom={{.State.OOMKilled}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}',
        containerName,
      ]);
      await spawnAndCapture('docker', ['rm', '-f', containerName]);
      await unmountWorkspaceTree(workspaceRoot);
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(
        `docker_runner_exit:${`${logs.stdout}\n${logs.stderr}`.slice(-1200)}:inspect=${inspectDetails.stdout.trim()}:log=${runnerLogPath}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  await preserveRunnerLogs();
  const logs = await spawnAndCapture('docker', ['logs', containerName]);
  await spawnAndCapture('docker', ['rm', '-f', containerName]);
  throw new Error(`docker_runner_connect_timeout:${`${logs.stdout}\n${logs.stderr}`.slice(-1200)}:log=${runnerLogPath}`);
}

export async function mountFileLibraryLocally(
  metadataUrl: string,
  storageBucketUrl?: string,
  options?: {
    metadataHostOverride?: string;
    metadataPortOverride?: string;
    storageEndpointOverride?: string;
  },
): Promise<{
  mountPath: string;
  stop: () => Promise<void>;
}> {
  const resolvedMetadataUrl = rewriteLocalClientMetadataUrl(metadataUrl, options);
  const resolvedStorageBucketUrl = rewriteLocalClientStorageBucketUrl(storageBucketUrl, options);
  const mountPath = await mkdtemp(path.join(tmpdir(), 'agentsmith-real-file-library-'));
  const mountArgs = [
    'mount',
    resolvedMetadataUrl,
    mountPath,
    '-d',
    '--check-storage',
    '--attr-cache',
    '0',
    '--entry-cache',
    '0',
    '--dir-entry-cache',
    '0',
  ];
  if ((resolvedStorageBucketUrl ?? '').trim()) {
    mountArgs.push('--bucket', resolvedStorageBucketUrl!.trim());
  }
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const mountResult = await spawnAndCapture('juicefs', mountArgs, { env: withoutProxyEnv() });
    if (mountResult.code === 0) {
      return {
        mountPath,
        stop: async () => {
          await unmountSingleWorkspace(mountPath);
          await rm(mountPath, { recursive: true, force: true }).catch(() => undefined);
        },
      };
    }
    lastError = mountResult.stderr.slice(-800);
    await unmountSingleWorkspace(mountPath).catch(() => undefined);
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  await rm(mountPath, { recursive: true, force: true }).catch(() => undefined);
  throw new Error(`local_juicefs_mount_failed:${lastError}`);
}

function rewriteLocalClientMetadataUrl(
  metadataUrl: string,
  options?: {
    metadataHostOverride?: string;
    metadataPortOverride?: string;
  },
): string {
  const hostOverride = options?.metadataHostOverride?.trim();
  const portOverride = options?.metadataPortOverride?.trim();
  if (!hostOverride && !portOverride) {
    return metadataUrl;
  }
  const rewritten = new URL(metadataUrl);
  if (hostOverride) {
    rewritten.hostname = hostOverride;
  }
  if (portOverride) {
    rewritten.port = portOverride;
  }
  return rewritten.toString();
}

function rewriteLocalClientStorageBucketUrl(
  storageBucketUrl?: string,
  options?: {
    storageEndpointOverride?: string;
  },
): string | undefined {
  const rawUrl = storageBucketUrl?.trim();
  if (!rawUrl) {
    return storageBucketUrl;
  }
  const endpointOverride = options?.storageEndpointOverride?.trim();
  if (!endpointOverride) {
    return rawUrl;
  }
  const original = new URL(rawUrl);
  const override = new URL(endpointOverride);
  original.protocol = override.protocol;
  original.username = override.username;
  original.password = override.password;
  original.hostname = override.hostname;
  original.port = override.port;
  return original.toString();
}

export async function waitForMountedWorkspacePath(
  mountPath: string,
  relativePath: string,
  timeoutMs = 90_000,
): Promise<string> {
  const absolutePath = path.join(mountPath, relativePath);
  const parentPath = path.dirname(absolutePath);
  const startedAt = Date.now();
  for (;;) {
    try {
      await access(parentPath);
      await access(absolutePath);
      return absolutePath;
    } catch {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`mounted_workspace_path_timeout:${relativePath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function waitForAnyMountedWorkspacePath(
  mountPath: string,
  relativePaths: string[],
  timeoutMs = 30_000,
): Promise<string> {
  const candidates = relativePaths.map((relativePath) => ({
    relativePath,
    absolutePath: path.join(mountPath, relativePath),
  }));
  const startedAt = Date.now();
  for (;;) {
    for (const candidate of candidates) {
      try {
        await access(candidate.absolutePath);
        return candidate.absolutePath;
      } catch {
        // keep polling until one candidate becomes visible
      }
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`mounted_workspace_path_timeout_any:${relativePaths.join(',')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function createFileLibraryViaUi(
  page: Page,
  workspaceId: string,
  projectId: string,
  name: string,
): Promise<string> {
  await page.goto(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/files`);
  await expect(page.getByTestId('files__library-create')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('files__library-create').click();
  const dialog = page.getByTestId('files__dialog__library-create');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('files__library-create__name').fill(name);
  await dialog.getByTestId('files__library-create__submit').click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: name }).first();
  await expect(libraryItem).toBeVisible({
    timeout: 30_000,
  });
  const libraryId = (await libraryItem.getAttribute('data-testid'))?.replace('files__library-item--', '');
  if (!libraryId) {
    throw new Error(`file_library_id_not_found:${name}`);
  }
  return libraryId;
}

export async function openMountAccessAndRevealMountDetails(
  page: Page,
  libraryName: string,
): Promise<{ metadataUrl: string; storageBucketUrl: string | null }> {
  const dismissOpenDialog = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const visibleDialog = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
      if (!(await visibleDialog.isVisible().catch(() => false))) {
        return;
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  };

  await dismissOpenDialog();
  const libraryItem = page.locator('[data-testid^="files__library-item--"]').filter({ hasText: libraryName }).first();
  await expect(libraryItem).toBeVisible({ timeout: 30_000 });
  const mountButton = libraryItem.locator('[data-testid^="files__library-mount-access--"]').first();
  await expect(mountButton).toBeVisible({ timeout: 15_000 });
  await mountButton.click();
  const dialog = page.getByTestId('files__dialog__library-mount-access');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: /reveal|显示|show/i }).click();
  const metadataInput = dialog.getByTestId('files__library-mount__metadata-url');
  await expect(metadataInput).not.toHaveValue(/••••/);
  const bucketInput = dialog.getByTestId('files__library-mount__bucket-url');
  return {
    metadataUrl: (await metadataInput.inputValue()).trim(),
    storageBucketUrl: (await bucketInput.inputValue()).trim() || null,
  };
}

export async function createTempMountDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function mountJuiceFs(metadataUrl: string, mountPoint: string, storageBucketUrl?: string): Promise<() => Promise<void>> {
  await mkdir(mountPoint, { recursive: true });
  const mountArgs = ['mount', metadataUrl, mountPoint, '-d', '--attr-cache', '0', '--entry-cache', '0', '--dir-entry-cache', '0'];
  if ((storageBucketUrl ?? '').trim()) {
    mountArgs.push('--bucket', storageBucketUrl!.trim());
  }
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'juicefs',
      mountArgs,
      { stdio: ['ignore', 'pipe', 'pipe'], env: withoutProxyEnv() },
    );
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`juicefs_mount_failed_${String(code)}:${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });
    setTimeout(() => resolve(), 5_000);
  });

  return async () => {
    await new Promise<void>((resolve) => {
      const proc = spawn('juicefs', ['umount', mountPoint], { stdio: 'ignore' });
      proc.once('error', () => resolve());
      proc.once('exit', () => resolve());
      setTimeout(() => resolve(), 5_000);
    });
    await rm(mountPoint, { recursive: true, force: true });
  };
}

export async function writeMountedFile(mountPoint: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(mountPoint, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf-8');
}
