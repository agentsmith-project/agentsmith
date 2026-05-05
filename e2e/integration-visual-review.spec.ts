import { expect, test, type Page } from '@playwright/test';
import {
  createAgentTaskViaApi,
  createManagedAgentRunnerViaApi,
  startAgentTaskRunViaApi,
  waitForRunnerOutputToken,
} from './integration-real-helpers';
import {
  openFileLibraryRoot,
  waitForTaskArtifacts,
} from './integration-governance-runtime-support';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const LOCALE = process.env.INTEGRATION_LOCALE ?? 'en-US';
const KEYCLOAK_BASE_URL = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? 'mbos';
const KEYCLOAK_WORKSPACE_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const BACKEND_REAL_ANTHROPIC_BASE_URL = process.env.BACKEND_REAL_ANTHROPIC_BASE_URL ?? 'https://anthropic-compatible.provider.example/v1';
const BACKEND_REAL_MODEL = process.env.BACKEND_REAL_MODEL ?? 'placeholder-model';
const BACKEND_REAL_API_KEY = process.env.BACKEND_REAL_API_KEY;
const DEV_ADMIN_USERNAME = process.env.INTEGRATION_DEV_ADMIN_USERNAME ?? 'dev-admin';
const DEV_ADMIN_PASSWORD = process.env.INTEGRATION_DEV_ADMIN_PASSWORD ?? 'dev-admin-123';
const PROJECT_CREATOR_USERNAME = process.env.INTEGRATION_USER_USERNAME ?? 'integration-user';
const PROJECT_CREATOR_PASSWORD = process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123';
const MEMBER_USERNAME = process.env.INTEGRATION_MEMBER_USERNAME ?? 'integration-member';
const MEMBER_PASSWORD = process.env.INTEGRATION_MEMBER_PASSWORD ?? 'integration-member-123';
const PROJECT_CREATOR_EMAIL = 'integration-user@example.com';
const AGENT_TASK_EXPECTED_TOKEN = `REAL_VISUAL_AGENT_TASK_OK_${Date.now()}`;
const AGENT_TASK_ARTIFACT_NAME = `visual-review-summary-${Date.now()}.md`;
type ProjectContext = {
  workspaceId: string;
  projectId: string;
  projectName: string;
};

type VisualReviewTraceMeta = {
  action: string;
  target: string;
  note: string;
};

const VISUAL_REVIEW_STORY = loadStoryDefinitionSync('real-backend-visual-review');
const VISUAL_REVIEW_STORY_BINDING = buildTraceStoryBinding(VISUAL_REVIEW_STORY);
const PROJECT_SURFACE_HANDOFF_STORY = loadStoryDefinitionSync('project-surface-handoff-continuity');
const PROJECT_SURFACE_HANDOFF_STORY_BINDING = buildTraceStoryBinding(PROJECT_SURFACE_HANDOFF_STORY);

function resolveVisualReviewTraceMeta(stepId: string, role: string): VisualReviewTraceMeta {
  const step = VISUAL_REVIEW_STORY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    return {
      action: `Review ${stepId}`,
      target: role,
      note: role,
    };
  }
  return {
    action: step.action,
    target: step.target ?? role,
    note: step.note ?? step.expectedFeedback,
  };
}

function requireRealLaneApiKey(): string {
  if (!BACKEND_REAL_API_KEY?.trim()) {
    throw new Error('missing_BACKEND_REAL_API_KEY');
  }
  return BACKEND_REAL_API_KEY.trim();
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
  await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Loading workspaces...')).not.toBeVisible({ timeout: 30_000 });
}

async function waitForWorkspaceId(page: Page, workspaceName: string): Promise<string> {
  const resolveWorkspaceId = async (name: string) =>
    page.evaluate(async (workspaceNameArg) => {
      try {
        const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await response.json()) as { items?: Array<{ id: string; name: string }> };
        return payload.items?.find((item) => item.name === workspaceNameArg)?.id ?? null;
      } catch {
        return null;
      }
    }, name);

  await expect
    .poll(
      async () => resolveWorkspaceId(workspaceName),
      { timeout: 30_000 },
    )
    .toBeTruthy();

  const resolved = await resolveWorkspaceId(workspaceName);

  if (!resolved) {
    throw new Error('workspace_id_not_found');
  }
  return resolved;
}

async function createAndPublishWorkspace(page: Page): Promise<string> {
  const workspaceName = `Real Visual Workspace ${Date.now()}`;
  await page.getByTestId('system-workspaces__new-workspace').click();
  await page.waitForURL(new RegExp(`/${LOCALE}/system/workspaces/new$`), { timeout: 30_000 });
  await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
  await page.getByTestId('system-workspace-create__next').click();
  await page.getByTestId('system-workspaces__draft-idp-url').fill(KEYCLOAK_BASE_URL);
  await page.getByTestId('system-workspaces__draft-idp-realm').fill(KEYCLOAK_REALM);
  await page.getByTestId('system-workspaces__draft-idp-client-id').fill(KEYCLOAK_WORKSPACE_CLIENT_ID);
  await verifyIdentityProvider(page);
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
  await page.getByTestId('system-workspace-create__next').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId('system-workspaces__admin-mode--email')).toBeVisible({ timeout: 15_000 });
}

async function loginToWorkspace(page: Page, workspaceId: string, username: string, password: string): Promise<void> {
  await clearAppState(page, workspaceId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/login`);
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
  const dialog = page.getByRole('dialog');
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
  await dialog.locator('#cred-name').fill('Provider Anthropic Key');
  await dialog.locator('#cred-value').fill(apiKey);
  await dialog.getByRole('button', { name: /create/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Provider Anthropic Key')).toBeVisible({ timeout: 30_000 });
}

async function createEndpoint(page: Page, workspaceId: string, projectId: string): Promise<{ endpointId: string; endpointName: string }> {
  const endpointName = 'Provider Anthropic Endpoint';
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/endpoints`);
  await expect(page.getByTestId('endpoints__create-btn')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('endpoints__create-btn').click();
  const dialog = page.getByTestId('endpoints__create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /use guided setup/i }).click();
  const wizard = page.getByTestId('endpoints__custom-wizard');
  await expect(wizard).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-name-input').fill(endpointName);
  await wizard.getByTestId('protocol-anthropic_messages').click();
  await wizard.getByTestId('wizard-base-url-input').fill(BACKEND_REAL_ANTHROPIC_BASE_URL);
  await wizard.getByRole('button', { name: /next|下一步/i }).click();
  await expect(wizard.getByTestId('wizard-model-id-input')).toBeVisible({ timeout: 30_000 });
  await wizard.getByTestId('wizard-model-id-input').fill(BACKEND_REAL_MODEL);
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

function apiBaseForPage(_page: Page): string {
  return process.env.INTEGRATION_API_BASE ?? 'http://localhost:20070';
}

async function runAgentTask(args: {
  page: Page;
  context: ProjectContext;
  fileLibraryId: string;
  expectedToken: string;
  artifactName: string;
}) {
  const { page, context, fileLibraryId, expectedToken, artifactName } = args;
  const taskTitle = `Release Review Task ${Date.now()}`;
  const artifactContent = [
    '# Market sizing summary',
    `- Token: ${expectedToken}`,
    '- Segment: North America consumer electronics',
    '- Insight: online channel share is expanding faster than retail',
    '- Recommendation: prioritize search plus retail media in the next planning cycle',
  ].join('\n');
  const expectedReply = `${expectedToken} ${artifactName}`;
  const taskId = await createAgentTaskViaApi({
    page,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    title: taskTitle,
    fileLibraryId,
  });
  await gotoWithRetry(page, `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/agent-tasks/${taskId}`);
  await expect(page.getByTestId('agent-tasks__conversation-input')).toBeVisible({ timeout: 30_000 });

  const run = await startAgentTaskRunViaApi({
    page,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    taskId,
    intent: [
      'Run the following shell command exactly, then reply with the token and filename.',
      '```bash',
      `mkdir -p .artifacts && cat <<'EOF' > .artifacts/${artifactName}`,
      artifactContent,
      'EOF',
      '```',
      `After the file is written, reply with exactly: ${expectedReply}`,
    ].join(' '),
  });
  await waitForRunnerOutputToken({
    page,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    taskId,
    token: expectedToken,
    runnerOutputActivityId: run.runnerOutputActivityId,
    runId: run.runId,
  });
  await waitForTaskArtifacts({
    page,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    taskId,
    expectedPath: `.artifacts/${artifactName}`,
  });
}

async function captureProjectPages(
  page: Page,
  capturePage: (page: Page, captures: unknown[], args: {
    name: string;
    role: string;
    notes: string;
    action?: string;
    target?: string;
    route?: string;
    fullPage?: boolean;
  }) => Promise<unknown>,
  captures: unknown[],
  context: ProjectContext,
  role: string,
) {
  const pages: Array<{ name: string; path: string; waitFor?: string }> = [
    { name: 'project-overview', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/overview`, waitFor: 'project-overview__page' },
    { name: 'project-chat', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/chat`, waitFor: 'chat__main-pane' },
    { name: 'project-agent-tasks', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/agent-tasks`, waitFor: 'agent-tasks__task-list' },
    { name: 'project-files', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/files`, waitFor: 'files__library-create' },
    { name: 'project-endpoints', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/endpoints`, waitFor: 'endpoints__create-btn' },
    { name: 'project-credentials', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/credentials`, waitFor: 'credentials__create-btn' },
    { name: 'project-agent-runners', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/agent-runners`, waitFor: 'agent-runners__create-btn' },
    { name: 'project-members', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/members`, waitFor: 'members__search-input' },
    { name: 'project-resource-policy', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/resource-policy`, waitFor: 'resource-policy__editor' },
    { name: 'project-audit', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/audit`, waitFor: 'audit__page' },
    { name: 'project-usage', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/usage`, waitFor: 'usage__work-surface' },
    { name: 'project-settings', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/settings`, waitFor: 'settings__general-section' },
    { name: 'project-use-guide', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/use-guide`, waitFor: 'use-guide__page' },
    { name: 'project-alerts', path: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/alerts`, waitFor: 'alerts__main-surface' },
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
    const traceMeta = resolveVisualReviewTraceMeta(item.name, role);
    await capturePage(page, captures, {
      name: item.name,
      role,
      notes,
      action: traceMeta.action,
      target: traceMeta.target,
    });
  }
}


async function captureProjectSurfaceHandoffContinuity(
  page: Page,
  capturePage: (page: Page, captures: unknown[], args: {
    name: string;
    role: string;
    notes: string;
    action?: string;
    target?: string;
    route?: string;
    fullPage?: boolean;
  }) => Promise<unknown>,
  captures: unknown[],
  context: ProjectContext,
  role: string,
) {
  const steps: Array<{
    name: string;
    action: string;
    target: string;
    notes: string;
    route: string;
    waitFor: string;
  }> = [
    {
      name: 'open-project-overview',
      action: 'Open project overview',
      target: 'project-overview__page',
      notes: '成员先回到 overview 作为日常 handoff hub。',
      route: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/overview`,
      waitFor: 'project-overview__page',
    },
    {
      name: 'handoff-to-chat',
      action: 'Switch to chat',
      target: 'sidebar__nav-item--chat',
      notes: '从 overview 切到 chat，仍然是同一个 project context。',
      route: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/chat`,
      waitFor: 'chat__main-pane',
    },
    {
      name: 'handoff-to-agent-tasks',
      action: 'Switch to Agent Tasks',
      target: 'sidebar__nav-item--agent-tasks',
      notes: '从 chat 切到 Agent Tasks，继续同一个项目工作流。',
      route: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/agent-tasks`,
      waitFor: 'agent-tasks__task-list',
    },
    {
      name: 'handoff-to-files',
      action: 'Switch to files',
      target: 'sidebar__nav-item--files',
      notes: '从 Agent Tasks 切到 files，仍保留项目壳层上下文。',
      route: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/files`,
      waitFor: 'files__library-create',
    },
    {
      name: 'return-to-overview',
      action: 'Return to overview',
      target: 'sidebar__nav-item--overview',
      notes: '回到 overview 后可以继续下一轮工作。',
      route: `/${LOCALE}/workspaces/${context.workspaceId}/projects/${context.projectId}/overview`,
      waitFor: 'project-overview__page',
    },
  ];

  for (const step of steps) {
    if (step.name === 'open-project-overview') {
      await gotoWithRetry(page, step.route);
    } else {
      await page.getByTestId(step.target).click();
    }
    await expect(page.getByTestId(step.waitFor)).toBeVisible({ timeout: 30_000 });
    await settlePage(page);
    await capturePage(page, captures, {
      name: step.name,
      role,
      notes: step.notes,
      action: step.action,
      target: step.target,
      route: step.route,
    });
  }
}

test.describe('@lane-real integration visual review', () => {
  test('captures real backend screenshots for main system and project surfaces', async ({ page }) => {
    test.setTimeout(900_000);
    const providerApiKey = requireRealLaneApiKey();
    const storyBinding = VISUAL_REVIEW_STORY_BINDING;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-visual-review',
      storyId: storyBinding.storyId,
      title: storyBinding.title,
      actor: storyBinding.actor,
      route: VISUAL_REVIEW_STORY.entryRoute,
      specFile: 'e2e/integration-visual-review.spec.ts',
      browser: 'chromium',
      goal: storyBinding.goal,
      preconditions: [...storyBinding.preconditions],
      seedData: [...storyBinding.seedData],
      storyBinding,
      allowUnboundStorySteps: true,
    });
    const captures: unknown[] = [];
    const capturePage = async (
      targetPage: Page,
      _unusedCaptures: unknown[],
      args: {
        name: string;
        role: string;
        notes: string;
        route?: string;
        fullPage?: boolean;
        action?: string;
        target?: string;
        note?: string;
      },
    ) => {
      const storyMeta = resolveVisualReviewTraceMeta(args.name, args.role);
      return trace.capture(targetPage, {
        stepId: args.name,
        action: args.action ?? storyMeta.action,
        target: args.target ?? storyMeta.target,
        route: args.route ?? targetPage.url(),
        note: args.note ?? storyMeta.note ?? args.notes,
        fullPage: args.fullPage,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
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
      await createCredential(page, workspaceId, project.projectId, providerApiKey);
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

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/agent-runners`);
      await expect(page.getByTestId('agent-runners__create-btn')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('agent-runners__create-btn').click();
      await expect(page.getByTestId('agent-runners__create-dialog')).toBeVisible();
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'dialog-create-agent-runner-real',
        role: 'project owner',
        notes: '真实环境 Agent Runner 创建对话框',
      });
      await page.getByTestId('agent-runners__create-dialog').getByRole('button', { name: /cancel|取消/i }).click();
      const runnerInfo = await createManagedAgentRunnerViaApi(page, {
        workspaceId,
        projectId: project.projectId,
        endpointId: endpointInfo.endpointId,
        title: `Real Visual Agent Task Runner ${Date.now()}`,
      });
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/agent-runners`);
      await expect(page.getByText(runnerInfo.runnerName)).toBeVisible({ timeout: 30_000 });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-agent-runners-real',
        role: 'project owner',
        notes: '真实 Agent Runner 列表',
      });

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
      await visualLibrary.locator('[data-testid^="files__library-desktop-access--"]').first().click();
      await expect(page.getByTestId('files__dialog__desktop-mount-access')).toBeVisible({ timeout: 30_000 });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'dialog-file-library-mount-access-real',
        role: 'project owner',
        notes: '真实文件库本地挂载说明对话框',
      });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('files__dialog__desktop-mount-access')).toBeHidden({ timeout: 10_000 });

      await captureProjectPages(page, capturePage, captures, project, 'project owner');
      await runAgentTask({
        page,
        context: project,
        fileLibraryId: visualLibraryId!,
        expectedToken: AGENT_TASK_EXPECTED_TOKEN,
        artifactName: AGENT_TASK_ARTIFACT_NAME,
      });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-agent-task-detail-real',
        role: 'project owner',
        notes: 'Agent Task 真实任务完成后的详情页',
      });
      const traceToggle = page.getByTestId('agent-tasks__message-process-details-toggle').first();
      if (await traceToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await traceToggle.click();
        await expect(page.getByTestId('agent-tasks__message-process-panel')).toBeVisible({ timeout: 30_000 });
        await settlePage(page);
        await capturePage(page, captures, {
          name: 'project-agent-task-trace-real',
          role: 'project owner',
          notes: '真实 Agent Task 的执行 trace 面板',
        });
      }

      await openFileLibraryRoot({
        page,
        workspaceId,
        projectId: project.projectId,
        libraryName: 'Visual Review Library',
      });
      const artifactsRow = page.getByTestId('files__object-row').filter({ hasText: '.artifacts' }).first();
      await expect(artifactsRow).toBeVisible({ timeout: 30_000 });
      await settlePage(page);
      await capturePage(page, captures, {
        name: 'project-files-agent-task-workspace-real',
        role: 'project owner',
        notes: 'Agent Task 绑定的文件库根目录，.artifacts 交付目录已经在 Files 页面中可见',
      });

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

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
    }
  });

  test('captures project surface handoff continuity for a normal project member moving among overview, chat, agent-task, and files', async ({ page }) => {
    test.setTimeout(600_000);
    const storyBinding = PROJECT_SURFACE_HANDOFF_STORY_BINDING;
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-visual-review',
      storyId: storyBinding.storyId,
      title: storyBinding.title,
      actor: storyBinding.actor,
      route: PROJECT_SURFACE_HANDOFF_STORY.entryRoute,
      specFile: 'e2e/integration-visual-review.spec.ts',
      browser: 'chromium',
      goal: storyBinding.goal,
      preconditions: [...storyBinding.preconditions],
      seedData: [...storyBinding.seedData],
      storyBinding,
    });
    const captures: unknown[] = [];
    const capturePage = async (
      targetPage: Page,
      _unusedCaptures: unknown[],
      args: {
        name: string;
        role: string;
        notes: string;
        route?: string;
        fullPage?: boolean;
        action?: string;
        target?: string;
        note?: string;
      },
    ) => {
      const storyMeta = resolveVisualReviewTraceMeta(args.name, args.role);
      return trace.capture(targetPage, {
        stepId: args.name,
        action: args.action ?? storyMeta.action,
        target: args.target ?? storyMeta.target,
        route: args.route ?? targetPage.url(),
        note: args.note ?? storyMeta.note ?? args.notes,
        fullPage: args.fullPage,
      });
    };
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await gotoWithRetry(page, `/${LOCALE}/system/login`);
      await settlePage(page);

      await loginAsSystemAdmin(page);
      const workspaceId = await createAndPublishWorkspace(page);
      await loginToWorkspace(page, workspaceId, DEV_ADMIN_USERNAME, DEV_ADMIN_PASSWORD);
      await saveWorkspaceProjectCreators(page, workspaceId);

      await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
      const project = await createProject(page, workspaceId);
      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await requestProjectAccess(page, workspaceId, project.projectId);

      await loginToWorkspace(page, workspaceId, PROJECT_CREATOR_USERNAME, PROJECT_CREATOR_PASSWORD);
      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${project.projectId}/members?member_tab=requests`);
      await approveJoinRequest(page, workspaceId, project.projectId);

      await loginToWorkspace(page, workspaceId, MEMBER_USERNAME, MEMBER_PASSWORD);
      await captureProjectSurfaceHandoffContinuity(page, capturePage, captures, project, 'project member');

      outcome = 'pass';
    } finally {
      await trace.finish({ outcome });
    }
  });
});
