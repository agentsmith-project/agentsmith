import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import {
  API_BASE,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  createManagedAgentRunnerViaApi,
  createCredentialViaUi,
  createProjectInWorkspace,
  expectAgentTaskConversationSurface,
  resolveIntegrationKeycloakBaseUrl,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import {
  resolveReleaseStoryAdminMode,
  type ReleaseStoryIdpVerifyResponse,
} from './integration-release-user-story.helpers';
import { RELEASE_USER_STORY } from './release-user-story.contract';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';
import { waitForSystemWorkspacesReady } from './utils/system-workspaces';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'mbos';
const KEYCLOAK_WORKSPACE_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const ANTHROPIC_BASE_URL = process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ?? 'https://api.deepseek.com/anthropic';
const OPENAI_BASE_URL = process.env.BACKEND_REAL_OPENAI_BASE_URL ?? 'https://api.deepseek.com';
const BACKEND_REAL_MODEL = process.env.BACKEND_REAL_MODEL ?? 'deepseek-v4-flash';
const PRESET_ENDPOINT_API_KEY = process.env.PRESET_ENDPOINT_API_KEY;
const SYSTEM_ADMIN_USERNAME = 'mbos-admin';
const SYSTEM_ADMIN_PASSWORD = 'mbos-admin';
const MEMBER_USERNAME = process.env.INTEGRATION_USER_USERNAME ?? 'integration-user';
const MEMBER_PASSWORD = process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123';
const DEMO_DEPLOY_MODE = process.env.INTEGRATION_DEMO_DEPLOY_MODE?.trim() || 'full';
const DEMO_MODE_IS_FULL = DEMO_DEPLOY_MODE === 'full';
const CREATE_NEW_TASK_RESPONSE_TIMEOUT_MS = 60_000;
const RELEASE_STORY_BINDING = buildTraceStoryBinding(RELEASE_USER_STORY.storyDefinition);

type ReleaseAgentTaskFlowTurn = {
  prompt: string;
  expectedToken: string;
  expectedArtifactPath: string;
};

type ReleaseAgentTaskFlow = {
  turnOne: ReleaseAgentTaskFlowTurn;
  turnTwo: ReleaseAgentTaskFlowTurn;
};

type AgentTaskRunStart = {
  runnerOutputActivityId: string;
  runId?: string;
};

function resolveReleaseStoryStep(stepId: string) {
  const step = RELEASE_STORY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown release story step: ${stepId}`);
  }
  return step;
}

function resolveReleaseStoryStepNote(stepId: string): string {
  const step = resolveReleaseStoryStep(stepId);
  return step.note ?? step.expectedFeedback;
}

function requireReleaseAgentTaskFlow(flowKey: string): ReleaseAgentTaskFlow {
  const flow = RELEASE_USER_STORY.storyDefinition.runtimeData?.agentTask?.[flowKey];
  if (!flow) {
    throw new Error(`missing_release_story_runtime_data:agentTask.${flowKey}`);
  }
  return flow as ReleaseAgentTaskFlow;
}

function requireRealLaneApiKey(): string {
  const value = PRESET_ENDPOINT_API_KEY?.trim();
  if (!value) {
    throw new Error('missing_PRESET_ENDPOINT_API_KEY');
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
  await waitForSystemWorkspacesReady(page);
}

async function loginToWorkspace(page: Page, workspaceId: string, username: string, password: string): Promise<void> {
  await clearWorkspaceAppState(page, workspaceId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/${LOCALE}/workspaces/${workspaceId}/login`);
    await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeEnabled({ timeout: 30_000 });
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

async function verifyIdentityProvider(page: Page): Promise<'directory_user' | 'email_pending'> {
  const responsePromise = page.waitForResponse(
    (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.getByTestId('system-workspace-create__next').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const payload = (await response.json().catch(() => null)) as ReleaseStoryIdpVerifyResponse | null;
  const adminMode = resolveReleaseStoryAdminMode(payload);
  await expect(page.getByTestId('system-workspaces__admin-mode--email')).toBeVisible({ timeout: 15_000 });
  if (adminMode === 'directory_user') {
    await expect(page.getByTestId('system-workspaces__draft-admin')).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(page.getByTestId('system-workspaces__draft-admin-email')).toBeVisible({ timeout: 15_000 });
  }
  return adminMode;
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
  await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
  await page.getByTestId('system-workspace-create__next').click();
  await page.getByTestId('system-workspaces__draft-idp-url').fill(
    resolveIntegrationKeycloakBaseUrl(process.env, { target: 'browser' }),
  );
  await page.getByTestId('system-workspaces__draft-idp-realm').fill(KEYCLOAK_REALM);
  await page.getByTestId('system-workspaces__draft-idp-client-id').fill(KEYCLOAK_WORKSPACE_CLIENT_ID);
  const adminMode = await verifyIdentityProvider(page);
  if (adminMode === 'directory_user') {
    await page.getByTestId('system-workspaces__admin-mode--email').click();
  }
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
  const protocolSelector = wizard.getByTestId(`protocol-${upstreamProtocol}`);
  if (await protocolSelector.isVisible().catch(() => false)) {
    await protocolSelector.click();
  } else {
    const protocolLabel =
      upstreamProtocol === 'anthropic_messages'
        ? /Anthropic Compatible|Anthropic/i
        : upstreamProtocol === 'openai_responses'
          ? /Responses/i
          : /OpenAI Compatible|OpenAI/i;
    await wizard.getByRole('button', { name: protocolLabel }).click();
  }
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

async function openCreateTaskDialog(page: Page, workspaceId: string, projectId: string): Promise<void> {
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks`);
  await expect(page.getByTestId('agent-tasks__create-task-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('agent-tasks__create-task-btn').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
}

async function createTaskViaUi(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  title: string;
  workspaceMode: 'create_new' | 'use_existing';
  workspaceName?: string;
  existingWorkspaceName?: string;
}): Promise<{ taskId: string; workspaceName: string }> {
  const { page, workspaceId, projectId, title, workspaceMode, workspaceName, existingWorkspaceName } = args;
  await openCreateTaskDialog(page, workspaceId, projectId);
  const dialog = page.getByRole('dialog');
  await dialog.locator('#task-title').fill(title);
  if (workspaceMode === 'use_existing') {
    await dialog.getByRole('radio', { name: /continue an existing task workspace/i }).click();
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
    throw new Error(`task_create_failed:${createResponse.status()}:${body}`);
  }
  await page.waitForURL(new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks/.+`), {
    timeout: 30_000,
  });
  await expectAgentTaskConversationSurface({
    page,
    openTerminalAction: 'enabled',
    terminalModeEnabled: false,
    blocked: false,
  });
  const taskId = page.url().match(/\/agent-tasks\/([^/?#]+)/)?.[1];
  if (!taskId) throw new Error('task_id_not_found_after_create');
  const workspaceBadge = await page.getByTestId('agent-task__task-header-workspace-library').textContent();
  const resolvedWorkspaceName = workspaceBadge?.split(':').slice(1).join(':').trim();
  if (!resolvedWorkspaceName) throw new Error('task_workspace_name_not_found');
  return { taskId, workspaceName: resolvedWorkspaceName };
}

async function sendAgentTaskMessage(page: Page, content: string): Promise<AgentTaskRunStart> {
  const input = page.getByTestId('agent-tasks__conversation-input').locator('textarea').first();
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(content);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST'
      && /\/api\/v1\/workspaces\/[^/]+\/projects\/[^/]+\/tasks\/[^/]+\/runs$/.test(response.url()),
    { timeout: 30_000 },
  );
  await page.getByTestId('agent-tasks__send-btn').click();
  const runResponse = await runResponsePromise;
  if (!runResponse.ok()) {
    const body = await runResponse.text().catch(() => '');
    throw new Error(`agent_task_run_failed:${runResponse.status()}:${body}`);
  }
  const payload = (await runResponse.json().catch(() => null)) as {
    id?: string;
    run_id?: string;
    actor?: string;
    kind?: string;
  } | null;
  const runnerOutputActivityId = payload?.id?.trim();
  if (!runnerOutputActivityId || payload?.actor !== 'runner' || payload.kind !== 'runner_output') {
    throw new Error('agent_task_run_response_missing_runner_output');
  }
  return {
    runnerOutputActivityId,
    ...(payload.run_id?.trim() ? { runId: payload.run_id.trim() } : {}),
  };
}

async function waitForAgentReply(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  taskId: string;
  expectedToken: string;
  minAgentMessages: number;
  run: AgentTaskRunStart;
}): Promise<void> {
  await waitForRunnerOutputToken({
    page: args.page,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    token: args.expectedToken,
    runnerOutputActivityId: args.run.runnerOutputActivityId,
    runId: args.run.runId,
    minRunnerOutputs: args.minAgentMessages,
  });
}

async function deleteCurrentTaskViaUi(page: Page, workspaceId: string, projectId: string): Promise<void> {
  const listPath = `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks`;
  const listUrl = new RegExp(`/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks$`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole('button', { name: /delete task|^delete$/i }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /delete task|^delete$/i }).click();
    const conflict = dialog.getByText(/workspace changed|refresh and try again/i);
    const outcome = await Promise.race([
      page.waitForURL(listUrl, { timeout: 30_000 }).then(() => 'deleted' as const),
      conflict.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'conflict' as const),
    ]);
    if (outcome === 'deleted') {
      return;
    }
    await page.reload({ waitUntil: 'load' });
    const notFoundHeading = page.getByRole('heading', { name: /task not found/i });
    const deleteButton = page.getByRole('button', { name: /delete task|^delete$/i });
    await Promise.race([
      page.waitForURL(listUrl, { timeout: 30_000 }).catch(() => undefined),
      notFoundHeading.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined),
      deleteButton.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined),
    ]);
    if (listUrl.test(page.url()) || await notFoundHeading.isVisible().catch(() => false)) {
      await gotoWithRetry(page, listPath);
      return;
    }
    await expect(deleteButton).toBeVisible({ timeout: 1_000 });
  }
  await page.waitForURL(listUrl, { timeout: 1 });
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

async function openTaskWorkspaceArtifactsFolder(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  workspaceName: string;
}): Promise<void> {
  await openWorkspaceFilesRoot(args);
  await openFolderByName(args.page, 'workspace');
  await openFolderByName(args.page, '.artifacts');
}

function normalizeFilesBrowsePrefix(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';
  const withoutLeading = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  return withoutLeading.endsWith('/') ? withoutLeading : `${withoutLeading}/`;
}

function currentFilesBrowsePrefix(page: Page): string {
  return normalizeFilesBrowsePrefix(new URL(page.url()).searchParams.get('prefix'));
}

function fileEntriesResponseMatchesPrefix(response: Response, expectedPrefix: string): boolean {
  const url = new URL(response.url());
  if (!url.pathname.endsWith('/entries')) return false;
  return normalizeFilesBrowsePrefix(url.searchParams.get('path')) === normalizeFilesBrowsePrefix(expectedPrefix);
}

async function expectFilesCurrentPrefix(
  page: Page,
  expectedPrefix: string,
  options?: { timeoutMs?: number },
): Promise<void> {
  const normalizedExpectedPrefix = normalizeFilesBrowsePrefix(expectedPrefix);
  await expect.poll(() => currentFilesBrowsePrefix(page), {
    timeout: options?.timeoutMs ?? 10_000,
    intervals: [100, 250, 500, 1_000],
    message: `Files did not navigate to prefix ${normalizedExpectedPrefix || '<root>'}`,
  }).toBe(normalizedExpectedPrefix);
}

async function readPrefixFromFolderRow(row: Locator, folderName: string): Promise<string> {
  const rowId = await row.getAttribute('data-row-id');
  if (!rowId?.startsWith('p:')) {
    throw new Error(`files_folder_row_missing_prefix:${folderName}:${rowId ?? '<missing>'}`);
  }
  return normalizeFilesBrowsePrefix(rowId.slice(2));
}

async function closeVisibleFilesDialog(page: Page): Promise<void> {
  const visibleDialog = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').last();
  if (!(await visibleDialog.isVisible().catch(() => false))) {
    return;
  }
  await page.keyboard.press('Escape');
  await expect(visibleDialog).toBeHidden({ timeout: 10_000 });
}

async function openFolderByName(page: Page, name: string): Promise<void> {
  await closeVisibleFilesDialog(page);

  let expectedPrefix = '';
  let lastPrefix = currentFilesBrowsePrefix(page);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const folderRow = page.getByTestId('files__object-row').filter({ hasText: name }).first();
    await expect(folderRow).toBeVisible({ timeout: 30_000 });
    expectedPrefix = await readPrefixFromFolderRow(folderRow, name);
    if (lastPrefix === expectedPrefix) {
      await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
      return;
    }

    const targetEntriesResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.ok()
      && fileEntriesResponseMatchesPrefix(response, expectedPrefix)
    ), { timeout: 10_000 }).catch(() => null);
    const button = folderRow.getByRole('button').first();
    if (await button.isVisible().catch(() => false)) {
      await button.dblclick();
    } else {
      await folderRow.dblclick();
    }

    const opened = await expectFilesCurrentPrefix(page, expectedPrefix, { timeoutMs: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) {
      await targetEntriesResponsePromise;
      await expect(page.getByTestId('files__objects-table')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('files__object-row').filter({ hasText: name }).first()).toBeHidden({
        timeout: 10_000,
      }).catch(() => undefined);
      return;
    }

    lastPrefix = currentFilesBrowsePrefix(page);
    await page.getByRole('button', { name: /^clear selection$/i }).click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }

  throw new Error(
    `files_folder_open_failed:${name}:expected_prefix=${expectedPrefix || '<unknown>'}:actual_prefix=${lastPrefix || '<root>'}`,
  );
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
  await expect(page.getByTestId('usage__work-surface')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('usage__summary-line')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('usage__limits')).toBeVisible({ timeout: 30_000 });
  const limitRows = page.getByTestId('usage__limit-row');
  await expect(limitRows).toHaveCount(4, { timeout: 30_000 });
  const requestLimitRow = limitRows.first();
  await expect(requestLimitRow).toContainText(/requests|请求/i, { timeout: 30_000 });
  await expect(requestLimitRow).toContainText(/usage|用量/i, { timeout: 30_000 });
  const valueText = ((await requestLimitRow.locator('p').nth(3).textContent()) ?? '').replace(/,/g, '').trim();
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
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-release-user-story',
      storyId: RELEASE_USER_STORY.manifest.storyId,
      title: RELEASE_USER_STORY.manifest.title,
      actor: RELEASE_USER_STORY.manifest.actor,
      route: `/${LOCALE}/system/login`,
      specFile: 'e2e/integration-release-user-story.spec.ts',
      browser: 'chromium',
      goal: RELEASE_USER_STORY.manifest.goal,
      preconditions: [...RELEASE_USER_STORY.manifest.preconditions],
      seedData: [...RELEASE_USER_STORY.manifest.seedData],
      storyBinding: RELEASE_STORY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    const captureTrace = async (stepId: string, action?: string, target?: string, note?: string): Promise<void> => {
      const storyStep = resolveReleaseStoryStep(stepId);
      await trace.capture(page, {
        stepId,
        action: action ?? storyStep.action,
        target: target ?? storyStep.target,
        note: note ?? resolveReleaseStoryStepNote(stepId),
      });
    };

    try {
      await gotoWithRetry(page, `/${LOCALE}/system/login`);
      await captureTrace('system-login', 'Open system login', 'system-login__heading', 'system 管理侧登录入口');

      await loginAsSystemAdmin(page);
      await captureTrace('system-workspaces', 'Review system workspaces', 'system-workspaces__list', '工作区清单与创建入口');

      const workspaceId = await createAndPublishWorkspace(page);
      await captureTrace('system-workspace-published', 'Create and publish workspace', 'system-workspaces__new-workspace', '新工作区创建并发布完成');

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
      await captureTrace('workspace-login', 'Open workspace login', 'workspace-login__keycloak-btn', '工作区登录入口');

      await loginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      await captureTrace('workspace-projects', 'Enter workspace projects', 'projects__heading', 'workspace admin 进入项目列表');

      const { projectId, projectName } = await createProjectInWorkspace(page, workspaceId, 'Release Story Project', {
        visibility: 'public',
        joinPolicy: 'approval_required',
      });
      await captureTrace('project-overview', 'Open project overview', 'project-overview__page', '项目创建成功后的 overview');

      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await captureTrace('projects-list-member', 'Review projects as member', 'projects__heading', '普通成员查看项目列表');
      await requestProjectAccess(page, workspaceId, projectId);
      await captureTrace('join-request-pending', 'Request project access', `projects__join-request-btn--${projectId}`, '普通成员发起加入申请后的待审批状态');

      await loginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/members?member_tab=requests`);
      await captureTrace('join-request-review', 'Review join request', 'members__requests-tab', '项目所有者查看待审批加入申请');
      await approveJoinRequest(page, workspaceId, projectId);
      await captureTrace('join-request-approved', 'Approve join request', 'members__people-tab', '加入申请已批准并授予项目访问');

      await createCredentialViaUi(page, workspaceId, projectId, 'Provider Unified Key', providerApiKey);
      await captureTrace('credentials-list', 'Review credentials', 'credentials__heading', '项目凭据列表');

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
      await captureTrace('endpoints-list', 'Review endpoints', 'endpoints__heading', '双 preset endpoint 列表');

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
      await captureTrace('resource-policy', 'Review resource policy', 'resource-policy__table', '双 endpoint 的资源策略已就绪');

      await createManagedAgentRunnerViaApi(page, {
        workspaceId,
        projectId,
        endpointId: primaryEndpointId,
        title: `Managed Agent Task Runner ${Date.now()}`,
      });
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-runners`);
      await expect(page.getByTestId('agent-runners__project-default-status')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('agent-runners__system-managed-section')).toBeVisible({ timeout: 30_000 });
      const systemManagedTable = page.getByTestId('agent-runners__system-managed-table');
      await expect(systemManagedTable).toBeVisible({ timeout: 30_000 });
      await expect(systemManagedTable.locator('[data-testid="agent-runners__system-managed-table__row"]').first()).toBeVisible({ timeout: 30_000 });
      await captureTrace('agent-runners-managed-list', 'Review Agent Runners', 'agent-runners__system-managed-table', '托管 Agent Runner 已创建');
      await captureTrace('agent-runners-managed-health', 'Review managed Agent Runner', 'agent-runners__project-default-status', '托管 Agent Runner 的健康状态可见');

      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await captureTrace('member-workspace-home', 'Return as member', 'projects__heading', '成员重新进入 workspace');

      const managedTaskOne = await createTaskViaUi({
        page,
        workspaceId,
        projectId,
        title: `Managed Agent Task A ${Date.now()}`,
        workspaceMode: 'create_new',
        workspaceName: `Managed Agent Task Workspace ${Date.now()}`,
      });
      await captureTrace('agent-task-managed-1', 'Create managed Agent Task', 'agent-task__task-header', 'managed Agent Task A created');
      const managedCreateFlow = requireReleaseAgentTaskFlow('managed_create');
      const managedCreateRunOne = await sendAgentTaskMessage(page, managedCreateFlow.turnOne.prompt);
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: managedTaskOne.taskId,
        expectedToken: managedCreateFlow.turnOne.expectedToken,
        minAgentMessages: 1,
        run: managedCreateRunOne,
      });
      const managedCreateRunTwo = await sendAgentTaskMessage(page, managedCreateFlow.turnTwo.prompt);
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: managedTaskOne.taskId,
        expectedToken: managedCreateFlow.turnTwo.expectedToken,
        minAgentMessages: 2,
        run: managedCreateRunTwo,
      });
      await waitForTaskArtifacts({
        page,
        workspaceId,
        projectId,
        taskId: managedTaskOne.taskId,
        expectedPath: managedCreateFlow.turnTwo.expectedArtifactPath,
      });
      const managedSummaryName = managedCreateFlow.turnTwo.expectedArtifactPath.split('/').pop() ?? managedCreateFlow.turnTwo.expectedArtifactPath;
      await openTaskWorkspaceArtifactsFolder({
        page,
        workspaceId,
        projectId,
        workspaceName: managedTaskOne.workspaceName,
      });
      await expect(page.getByText(managedSummaryName)).toBeVisible({ timeout: 30_000 });
      await captureTrace('files-artifacts-managed', 'Inspect generated artifacts', 'files__objects-table', 'managed Agent Task workspace/.artifacts visible');

      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-tasks/${managedTaskOne.taskId}`);
      await expectAgentTaskConversationSurface({
        page,
        openTerminalAction: 'enabled',
        terminalModeEnabled: false,
        blocked: false,
      });
      await captureTrace('agent-task-detail-managed', 'Review task detail', 'agent-task__task-header', 'managed Agent Task detail');

      await deleteCurrentTaskViaUi(page, workspaceId, projectId);

      const managedTaskTwo = await createTaskViaUi({
        page,
        workspaceId,
        projectId,
        title: `Managed Agent Task B ${Date.now()}`,
        workspaceMode: 'use_existing',
        existingWorkspaceName: managedTaskOne.workspaceName,
      });
      expect(managedTaskTwo.workspaceName).toBe(managedTaskOne.workspaceName);
      const managedReuseFlow = requireReleaseAgentTaskFlow('managed_reuse');
      const managedReuseRunOne = await sendAgentTaskMessage(page, managedReuseFlow.turnOne.prompt);
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: managedTaskTwo.taskId,
        expectedToken: managedReuseFlow.turnOne.expectedToken,
        minAgentMessages: 1,
        run: managedReuseRunOne,
      });
      const managedReuseRunTwo = await sendAgentTaskMessage(page, managedReuseFlow.turnTwo.prompt);
      await waitForAgentReply({
        page,
        workspaceId,
        projectId,
        taskId: managedTaskTwo.taskId,
        expectedToken: managedReuseFlow.turnTwo.expectedToken,
        minAgentMessages: 2,
        run: managedReuseRunTwo,
      });
      await waitForTaskArtifacts({
        page,
        workspaceId,
        projectId,
        taskId: managedTaskTwo.taskId,
        expectedPath: managedReuseFlow.turnTwo.expectedArtifactPath,
      });
      await expectAgentTaskConversationSurface({
        page,
        openTerminalAction: 'enabled',
        terminalModeEnabled: false,
        blocked: false,
      });
      await captureTrace('agent-task-detail-managed-reuse', 'Review reused workspace task', 'agent-task__task-header', 'managed Agent Task B reused workspace');

      if (DEMO_MODE_IS_FULL) {
        await loginToWorkspace(page, workspaceId, KEYCLOAK_DEV_ADMIN_USERNAME, KEYCLOAK_DEV_ADMIN_PASSWORD);
        await createManagedAgentRunnerViaApi(page, {
          workspaceId,
          projectId,
          endpointId: secondaryEndpointId,
          title: `Managed Continuity Runner ${Date.now()}`,
        });
        await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/agent-runners`);
        await expect(page.getByTestId('agent-runners__project-default-status')).toBeVisible({ timeout: 30_000 });
        await captureTrace(
          'managed-continuity-governance-config',
          'Configure managed continuity runner',
          'agent-runners__project-default-status',
          '项目所有者执行治理配置：切换到 secondary endpoint 的托管 Agent Runner',
        );

        await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
        await captureTrace(
          'member-workspace-home-after-governance-config',
          'Return as member after managed runner config',
          'projects__heading',
          '普通成员重新进入 workspace，继续使用托管 Agent Runner',
        );

        const internalTask = await createTaskViaUi({
          page,
          workspaceId,
          projectId,
          title: `Internal Task ${Date.now()}`,
          workspaceMode: 'create_new',
          workspaceName: `Managed Continuity Workspace ${Date.now()}`,
        });
        const internalFlow = requireReleaseAgentTaskFlow('managed_continuity');
        const internalRunOne = await sendAgentTaskMessage(page, internalFlow.turnOne.prompt);
        await waitForAgentReply({
          page,
          workspaceId,
          projectId,
          taskId: internalTask.taskId,
          expectedToken: internalFlow.turnOne.expectedToken,
          minAgentMessages: 1,
          run: internalRunOne,
        });
        const internalRunTwo = await sendAgentTaskMessage(page, internalFlow.turnTwo.prompt);
        await waitForAgentReply({
          page,
          workspaceId,
          projectId,
          taskId: internalTask.taskId,
          expectedToken: internalFlow.turnTwo.expectedToken,
          minAgentMessages: 2,
          run: internalRunTwo,
        });
        await waitForTaskArtifacts({
          page,
          workspaceId,
          projectId,
          taskId: internalTask.taskId,
          expectedPath: internalFlow.turnTwo.expectedArtifactPath,
        });
        const internalSummaryName = internalFlow.turnTwo.expectedArtifactPath.split('/').pop() ?? internalFlow.turnTwo.expectedArtifactPath;
        await openTaskWorkspaceArtifactsFolder({
          page,
          workspaceId,
          projectId,
          workspaceName: internalTask.workspaceName,
        });
        await expect(page.getByText(internalSummaryName)).toBeVisible({ timeout: 30_000 });
        await captureTrace('files-artifacts-managed-continuity', 'Inspect managed continuity artifacts', 'files__objects-table', 'managed Agent Task 的 workspace/.artifacts 已可见');

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
      await captureTrace('usage-overview', 'Review usage metrics', 'usage__view', 'usage 页面已验证 endpoint 请求数据');

      expect(pageErrors).toEqual([]);
      expect(projectName).toContain('Release Story Project');
      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
    }
  });
});
