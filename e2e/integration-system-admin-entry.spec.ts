import { expect, test, type Page } from '@playwright/test';
import {
  keycloakLoginToWorkspace,
  LOCALE,
  SYSTEM_ADMIN_PASSWORD,
  SYSTEM_ADMIN_USERNAME,
  KEYCLOAK_DEV_ADMIN_PASSWORD,
  KEYCLOAK_DEV_ADMIN_USERNAME,
  KEYCLOAK_INTEGRATION_MEMBER_EMAIL,
  KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
  KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
  KEYCLOAK_INTEGRATION_USER_EMAIL,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
} from './integration-real-helpers';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const SYSTEM_ADMIN_ENTRY_STORY = loadStoryDefinitionSync('system-admin-entry');
const SYSTEM_ADMIN_ENTRY_BINDING = buildTraceStoryBinding(SYSTEM_ADMIN_ENTRY_STORY);
const SYSTEM_MULTI_WORKSPACE_STORY = loadStoryDefinitionSync('system-admin-multi-workspace-handoff');
const SYSTEM_MULTI_WORKSPACE_BINDING = buildTraceStoryBinding(SYSTEM_MULTI_WORKSPACE_STORY);
const SEEDED_WORKSPACE_ID = SYSTEM_ADMIN_ENTRY_STORY.seedData?.[0] ?? null;

type SystemMultiWorkspaceRuntime = {
  workspaceAlphaNamePrefix: string;
  workspaceBetaNamePrefix: string;
  workspaceAlphaAdminEmail: string;
  workspaceBetaAdminEmail: string;
};

function resolveEntryStep(stepId: string) {
  const step = SYSTEM_ADMIN_ENTRY_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_system_admin_entry_step:${stepId}`);
  }
  return step;
}

function resolveMultiWorkspaceStep(stepId: string) {
  const step = SYSTEM_MULTI_WORKSPACE_BINDING.steps.find((entry) => entry.stepId === stepId);
  if (!step) {
    throw new Error(`unknown_system_admin_multi_workspace_step:${stepId}`);
  }
  return step;
}

function requireSystemMultiWorkspaceRuntime(): SystemMultiWorkspaceRuntime {
  const runtimeRoot = SYSTEM_MULTI_WORKSPACE_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.systemAdminMultiWorkspaceHandoff as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_system_multi_workspace_runtime_data');
  }
  for (const key of ['workspaceAlphaNamePrefix', 'workspaceBetaNamePrefix', 'workspaceAlphaAdminEmail', 'workspaceBetaAdminEmail'] as const) {
    if (typeof runtime[key] !== 'string' || runtime[key].trim().length === 0) {
      throw new Error(`missing_system_multi_workspace_runtime_data:${key}`);
    }
  }
  return runtime as unknown as SystemMultiWorkspaceRuntime;
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

async function loginAsSystemAdmin(page: Page): Promise<void> {
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
  await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/${LOCALE}/system/workspaces(?:$|\\?)`));
  await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });
}

async function mockWorkspaceAdminDirectory(page: Page): Promise<void> {
  await page.route('**/api/system/workspaces/idp/verify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        idp_ok: true,
        directory_search_supported: true,
      }),
    });
  });

  await page.route('**/api/system/workspaces/directory/users', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { query?: string } | undefined;
    const query = body?.query?.trim().toLowerCase() ?? '';
    const users = [
      { user_id: 'kc-dev-admin', email: 'dev-admin@example.com', name: 'Dev Admin' },
      { user_id: 'kc-integration-user', email: KEYCLOAK_INTEGRATION_USER_EMAIL, name: 'Integration User' },
      { user_id: 'kc-integration-member', email: KEYCLOAK_INTEGRATION_MEMBER_EMAIL, name: 'Integration Member' },
    ].filter((user) => user.email.toLowerCase().includes(query));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: users, total: users.length }),
    });
  });
}

async function openCreateWorkspace(page: Page): Promise<void> {
  await page.getByTestId('system-workspaces__new-workspace').click();
  await page.waitForURL(/\/en-US\/system\/workspaces\/new$/, { timeout: 15_000 });
  await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible({ timeout: 30_000 });
}

async function waitForWorkspaceId(page: Page, workspaceName: string): Promise<string> {
  await expect.poll(
    async () => {
      const urlWorkspaceId = new URL(page.url()).searchParams.get('workspace');
      if (urlWorkspaceId) {
        return urlWorkspaceId;
      }

      const response = await page.evaluate(async (name) => {
        const result = await fetch('/api/system/workspaces', { cache: 'no-store' });
        const payload = (await result.json()) as { items?: Array<{ id: string; name: string }> };
        return payload.items?.find((item) => item.name === name)?.id ?? null;
      }, workspaceName);
      return response;
    },
    { timeout: 30_000 },
  ).toBeTruthy();

  const urlWorkspaceId = new URL(page.url()).searchParams.get('workspace');
  if (urlWorkspaceId) {
    return urlWorkspaceId;
  }

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

async function verifyIdentityProvider(page: Page, options?: { directorySearchEnabled?: boolean }): Promise<void> {
  await page.getByTestId('system-workspaces__draft-idp-url').fill(process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080');
  await page.getByTestId('system-workspaces__draft-idp-realm').fill(process.env.KEYCLOAK_REALM ?? 'mbos');
  await page.getByTestId('system-workspaces__draft-idp-client-id').fill(process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith');
  if (options?.directorySearchEnabled) {
    await page.getByTestId('system-workspaces__draft-directory-client-id').fill(process.env.KEYCLOAK_DIRECTORY_CLIENT_ID ?? 'agentsmith-directory');
    await page.getByTestId('system-workspaces__draft-idp-client-secret').fill(process.env.KEYCLOAK_DIRECTORY_CLIENT_SECRET ?? 'agentsmith-directory-secret');
  }
  const responsePromise = page.waitForResponse(
    (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await page.getByTestId('system-workspace-create__next').click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
}

async function selectWorkspaceAdmin(page: Page, email: string): Promise<void> {
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

async function bootstrapAndPublishWorkspace(page: Page, args: {
  workspaceNamePrefix: string;
  adminEmail: string;
  directorySearchEnabled: boolean;
}): Promise<{ workspaceId: string; workspaceName: string }> {
  const workspaceName = `${args.workspaceNamePrefix} ${Date.now()}`;

  await openCreateWorkspace(page);
  await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
  await page.getByTestId('system-workspace-create__next').click();
  await expect(page.getByTestId('system-workspace-create__step--identity')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('system-workspaces__draft-idp-url')).toBeVisible({ timeout: 15_000 });
  await verifyIdentityProvider(page, { directorySearchEnabled: args.directorySearchEnabled });
  if (args.directorySearchEnabled) {
    await page.getByTestId('system-workspaces__admin-mode--directory').click();
    await selectWorkspaceAdmin(page, args.adminEmail);
  } else {
    await page.getByTestId('system-workspaces__admin-mode--email').click();
    await page.getByTestId('system-workspaces__draft-admin-email').fill(args.adminEmail);
  }

  await page.getByTestId('system-workspace-create__next').click();
  await expect(page.getByTestId('system-workspace-create__create')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('system-workspace-create__create').click();
  const workspaceId = await waitForWorkspaceId(page, workspaceName);

  await expect(page.getByTestId(`system-workspaces__card--${workspaceId}`)).toBeVisible({ timeout: 30_000 });
  await page.goto(`/${LOCALE}/system/workspaces?workspace=${workspaceId}`);
  await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`system-workspaces__card--${workspaceId}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`system-workspaces__card--${workspaceId}`).click();
  await expect(page.getByTestId('system-workspaces__editor')).toContainText(workspaceName, { timeout: 30_000 });
  await expect(page.getByTestId('system-workspaces__editor').getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
  await page.getByTestId('system-workspaces__publish').click();

  await page.goto(`/${LOCALE}/system/workspaces?workspace=${workspaceId}`);
  await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`system-workspaces__card--${workspaceId}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`system-workspaces__card--${workspaceId}`).click();
  await expect(page.getByTestId('system-workspaces__editor')).toContainText(args.adminEmail, { timeout: 30_000 });
  await expect(page.getByTestId('system-workspaces__editor').getByTestId(`system-workspaces__open-workspace-login--${workspaceId}`)).toBeVisible({ timeout: 30_000 });

  return { workspaceId, workspaceName };
}

test.describe('@lane-real integration system admin entry', () => {
  test('system admin can reach the workspace administration directory without access churn', async ({ page }) => {
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-system-admin-entry',
      storyId: SYSTEM_ADMIN_ENTRY_STORY.storyId,
      title: SYSTEM_ADMIN_ENTRY_STORY.title,
      actor: SYSTEM_ADMIN_ENTRY_STORY.actor,
      route: SYSTEM_ADMIN_ENTRY_STORY.entryRoute,
      specFile: 'e2e/integration-system-admin-entry.spec.ts',
      browser: 'chromium',
      goal: SYSTEM_ADMIN_ENTRY_STORY.goal,
      preconditions: [...(SYSTEM_ADMIN_ENTRY_STORY.preconditions ?? [])],
      seedData: [...(SYSTEM_ADMIN_ENTRY_STORY.seedData ?? [])],
      storyBinding: SYSTEM_ADMIN_ENTRY_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await page.context().clearCookies();
      await page.goto(`/${LOCALE}/system/login`);
      await expect(page.getByTestId('system-login__heading')).toBeVisible({ timeout: 30_000 });
      const loginStep = resolveEntryStep('system-login');
      await trace.capture(page, {
        stepId: 'system-login',
        action: loginStep.action,
        target: loginStep.target,
        note: loginStep.note ?? loginStep.expectedFeedback,
      });

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
      await expect.poll(() => page.url(), { timeout: 30_000 }).toMatch(new RegExp(`/${LOCALE}/system/workspaces(?:$|\\?)`));
      await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });
      if (SEEDED_WORKSPACE_ID) {
        await expect(page.getByTestId(`system-workspaces__card--${SEEDED_WORKSPACE_ID}`)).toBeVisible({ timeout: 30_000 });
      }
      const workspacesStep = resolveEntryStep('system-workspaces');
      await trace.capture(page, {
        stepId: 'system-workspaces',
        action: workspacesStep.action,
        target: workspacesStep.target,
        note: workspacesStep.note ?? workspacesStep.expectedFeedback,
      });
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });

  test('system admin can hand off multiple workspaces and truthfully re-enter each real workspace admin later', async ({ page }) => {
    const runtime = requireSystemMultiWorkspaceRuntime();
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-system-admin-entry',
      storyId: SYSTEM_MULTI_WORKSPACE_STORY.storyId,
      title: SYSTEM_MULTI_WORKSPACE_STORY.title,
      actor: SYSTEM_MULTI_WORKSPACE_STORY.actor,
      route: SYSTEM_MULTI_WORKSPACE_STORY.entryRoute,
      specFile: 'e2e/integration-system-admin-entry.spec.ts',
      browser: 'chromium',
      goal: SYSTEM_MULTI_WORKSPACE_STORY.goal,
      preconditions: [...(SYSTEM_MULTI_WORKSPACE_STORY.preconditions ?? [])],
      seedData: [...(SYSTEM_MULTI_WORKSPACE_STORY.seedData ?? [])],
      storyBinding: SYSTEM_MULTI_WORKSPACE_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await mockWorkspaceAdminDirectory(page);
      await loginAsSystemAdmin(page);
      await trace.capture(page, {
        stepId: 'open-system-login',
        action: resolveMultiWorkspaceStep('open-system-login').action,
        target: resolveMultiWorkspaceStep('open-system-login').target,
        note: resolveMultiWorkspaceStep('open-system-login').note ?? resolveMultiWorkspaceStep('open-system-login').expectedFeedback,
      });

      const alpha = await bootstrapAndPublishWorkspace(page, {
        workspaceNamePrefix: runtime.workspaceAlphaNamePrefix,
        adminEmail: runtime.workspaceAlphaAdminEmail,
        directorySearchEnabled: false,
      });
      await trace.capture(page, {
        stepId: 'bootstrap-workspace-alpha',
        action: resolveMultiWorkspaceStep('bootstrap-workspace-alpha').action,
        target: `system-workspaces__card--${alpha.workspaceId}`,
        note: resolveMultiWorkspaceStep('bootstrap-workspace-alpha').note ?? resolveMultiWorkspaceStep('bootstrap-workspace-alpha').expectedFeedback,
      });

      const beta = await bootstrapAndPublishWorkspace(page, {
        workspaceNamePrefix: runtime.workspaceBetaNamePrefix,
        adminEmail: runtime.workspaceBetaAdminEmail,
        directorySearchEnabled: false,
      });
      await trace.capture(page, {
        stepId: 'bootstrap-workspace-beta',
        action: resolveMultiWorkspaceStep('bootstrap-workspace-beta').action,
        target: `system-workspaces__card--${beta.workspaceId}`,
        note: resolveMultiWorkspaceStep('bootstrap-workspace-beta').note ?? resolveMultiWorkspaceStep('bootstrap-workspace-beta').expectedFeedback,
      });

      await page.goto(`/${LOCALE}/system/workspaces?workspace=${alpha.workspaceId}`);
      await expect(page.getByTestId('system-workspaces__list')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`system-workspaces__card--${alpha.workspaceId}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`system-workspaces__card--${beta.workspaceId}`)).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'review-system-workspaces',
        action: resolveMultiWorkspaceStep('review-system-workspaces').action,
        target: resolveMultiWorkspaceStep('review-system-workspaces').target,
        note: resolveMultiWorkspaceStep('review-system-workspaces').note ?? resolveMultiWorkspaceStep('review-system-workspaces').expectedFeedback,
      });

      await page.getByTestId(`system-workspaces__card--${alpha.workspaceId}`).click();
      await expect(page.getByTestId('system-workspaces__editor')).toContainText(alpha.workspaceName, { timeout: 30_000 });
      await page.getByTestId('system-workspaces__editor').getByTestId(`system-workspaces__open-workspace-login--${alpha.workspaceId}`).click();
      await page.waitForURL(
        (url) => new URL(url.toString()).pathname === `/${LOCALE}/workspaces/${alpha.workspaceId}/login`,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'reenter-workspace-alpha',
        action: resolveMultiWorkspaceStep('reenter-workspace-alpha').action,
        target: resolveMultiWorkspaceStep('reenter-workspace-alpha').target,
        note: resolveMultiWorkspaceStep('reenter-workspace-alpha').note ?? resolveMultiWorkspaceStep('reenter-workspace-alpha').expectedFeedback,
      });
      const alphaContext = await page.context().browser()?.newContext();
      if (!alphaContext) {
        throw new Error('missing_browser_for_alpha_workspace_reentry');
      }
      const alphaPage = await alphaContext.newPage();
      try {
        await keycloakLoginToWorkspace(
          alphaPage,
          alpha.workspaceId,
          KEYCLOAK_DEV_ADMIN_USERNAME,
          KEYCLOAK_DEV_ADMIN_PASSWORD,
        );
        await expect(alphaPage.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
        await expect(alphaPage.getByTestId('projects__create-btn')).toBeEnabled({ timeout: 30_000 });
      } finally {
        await alphaContext.close();
      }

      await page.goto(`/${LOCALE}/system/workspaces?workspace=${beta.workspaceId}`);
      await page.getByTestId(`system-workspaces__card--${beta.workspaceId}`).click();
      await expect(page.getByTestId('system-workspaces__editor')).toContainText(beta.workspaceName, { timeout: 30_000 });
      await page.getByTestId('system-workspaces__editor').getByTestId(`system-workspaces__open-workspace-login--${beta.workspaceId}`).click();
      await page.waitForURL(
        (url) => new URL(url.toString()).pathname === `/${LOCALE}/workspaces/${beta.workspaceId}/login`,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('workspace-login__keycloak-btn')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, {
        stepId: 'reenter-workspace-beta',
        action: resolveMultiWorkspaceStep('reenter-workspace-beta').action,
        target: resolveMultiWorkspaceStep('reenter-workspace-beta').target,
        note: resolveMultiWorkspaceStep('reenter-workspace-beta').note ?? resolveMultiWorkspaceStep('reenter-workspace-beta').expectedFeedback,
      });
      const betaContext = await page.context().browser()?.newContext();
      if (!betaContext) {
        throw new Error('missing_browser_for_beta_workspace_reentry');
      }
      const betaPage = await betaContext.newPage();
      try {
        await keycloakLoginToWorkspace(
          betaPage,
          beta.workspaceId,
          KEYCLOAK_INTEGRATION_MEMBER_USERNAME,
          KEYCLOAK_INTEGRATION_MEMBER_PASSWORD,
        );
        await expect(betaPage.getByTestId('projects__create-btn')).toBeVisible({ timeout: 30_000 });
        await expect(betaPage.getByTestId('projects__create-btn')).toBeEnabled({ timeout: 30_000 });
      } finally {
        await betaContext.close();
      }
      outcome = 'pass';
    } finally {
      await trace.finish({ outcome, finishedAt: new Date().toISOString() });
    }
  });
});
