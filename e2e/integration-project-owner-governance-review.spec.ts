import type { AddressInfo } from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import {
  API_BASE,
  createCredentialViaUi,
  createEndpointViaApi,
  createProjectInWorkspace,
  ensureIntegrationKeycloakUsers,
  KEYCLOAK_INTEGRATION_USER_EMAIL,
  KEYCLOAK_INTEGRATION_USER_PASSWORD,
  KEYCLOAK_INTEGRATION_USER_USERNAME,
  keycloakLoginToWorkspace,
  LOCALE,
} from './integration-real-helpers';
import { readStoredAuthToken } from './integration-workspace-access';
import { loadStoryDefinitionSync } from './story-loader';
import { buildTraceStoryBinding } from './story-trace-binding';
import { createUxTraceBundleWriter } from './trace-bundle-support';

const GOVERNANCE_REVIEW_STORY = loadStoryDefinitionSync(
  path.resolve(process.cwd(), 'e2e/stories/backend-real/project-owner-daily-governance-review.story.md'),
);
const GOVERNANCE_REVIEW_BINDING = buildTraceStoryBinding(GOVERNANCE_REVIEW_STORY);

type GovernanceReviewRuntime = {
  projectNamePrefix: string;
  credentialNamePrefix: string;
  endpointNamePrefix: string;
  alertRuleNamePrefix: string;
  model: string;
  expectedReplyText: string;
  threshold: number;
};

function requireGovernanceReviewRuntime(): GovernanceReviewRuntime {
  const runtimeRoot = GOVERNANCE_REVIEW_STORY.runtimeData as Record<string, unknown> | undefined;
  const runtime = runtimeRoot?.governanceReview as Record<string, unknown> | undefined;
  if (!runtime) {
    throw new Error('missing_governance_review_runtime');
  }

  for (const field of [
    'projectNamePrefix',
    'credentialNamePrefix',
    'endpointNamePrefix',
    'alertRuleNamePrefix',
    'model',
    'expectedReplyText',
  ] as const) {
    if (typeof runtime[field] !== 'string' || runtime[field].trim().length === 0) {
      throw new Error(`missing_governance_review_runtime:${field}`);
    }
  }
  if (typeof runtime.threshold !== 'number' || !Number.isFinite(runtime.threshold) || runtime.threshold <= 0) {
    throw new Error('missing_governance_review_runtime:threshold');
  }

  return runtime as unknown as GovernanceReviewRuntime;
}

async function gotoWithRetry(page: Page, pathOrUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
      const retryable =
        message.includes('ERR_ABORTED')
        || message.includes('ERR_CONNECTION_REFUSED')
        || message.includes('ERR_CONNECTION_RESET')
        || message.includes('ERR_FAILED')
        || message.includes('blank_navigation')
        || message.includes('empty_document');
      if (!retryable || attempt === 4) {
        throw error;
      }
      await page.waitForTimeout(500 * (attempt + 1));
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

async function loginAsSystemAdminForGovernanceReview(page: Page): Promise<void> {
  await page.context().clearCookies();
  await waitForSystemLoginReady(page);
  await page.getByTestId('system-login__username').fill('mbos-admin');
  await page.getByTestId('system-login__password').fill('mbos-admin');

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
  await expect(page.getByTestId('system-workspaces__new-workspace')).toBeVisible({ timeout: 30_000 });
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

  if (!resolved) {
    throw new Error('governance_review_workspace_id_not_found');
  }
  return resolved;
}

async function createAndPublishWorkspaceForGovernanceReview(page: Page): Promise<string> {
  const workspaceName = `Owner Governance Workspace ${Date.now()}`;
  const keycloakBaseUrl = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
  const keycloakRealm = process.env.KEYCLOAK_REALM ?? 'mbos';
  const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';

  await page.getByTestId('system-workspaces__new-workspace').click();
  await page.waitForURL(new RegExp(`/${LOCALE}/system/workspaces/new$`), { timeout: 30_000 });
  await expect(page.getByTestId('system-workspace-create__shell')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('system-workspaces__draft-name')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('system-workspaces__draft-name').fill(workspaceName);
  await page.getByTestId('system-workspace-create__next').click();

  await page.getByTestId('system-workspaces__draft-idp-url').fill(keycloakBaseUrl);
  await page.getByTestId('system-workspaces__draft-idp-realm').fill(keycloakRealm);
  await page.getByTestId('system-workspaces__draft-idp-client-id').fill(keycloakClientId);

  const verifyResponse = page.waitForResponse(
    (candidate) => candidate.url().includes('/api/system/workspaces/idp/verify') && candidate.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.getByTestId('system-workspace-create__next').click();
  expect((await verifyResponse).ok()).toBeTruthy();
  await expect(page.getByTestId('system-workspaces__admin-mode--email')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('system-workspaces__admin-mode--email').click();
  await page.getByTestId('system-workspaces__draft-admin-email').fill(KEYCLOAK_INTEGRATION_USER_EMAIL);
  await page.getByTestId('system-workspace-create__next').click();
  await page.getByTestId('system-workspace-create__create').click();

  const workspaceId = await waitForWorkspaceId(page, workspaceName);
  await gotoWithRetry(page, `/${LOCALE}/system/workspaces?workspace=${workspaceId}`);
  await expect(page.getByTestId(`system-workspaces__configure--${workspaceId}`)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`system-workspaces__configure--${workspaceId}`).click();
  await expect(page.getByTestId('system-workspaces__publish')).toBeVisible({ timeout: 30_000 });
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
      { timeout: 40_000 },
    )
    .toMatch(/^ready:/);

  return workspaceId;
}

async function startAnthropicCompatibleUpstream(replyText: string): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'POST' && requestUrl.pathname.endsWith('/messages')) {
        const body = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          req.on('error', reject);
        });
        const parsed = body.trim().length > 0
          ? JSON.parse(body) as { stream?: boolean }
          : {};
        if (parsed.stream) {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/event-stream');
          res.setHeader('cache-control', 'no-cache');
          res.setHeader('connection', 'keep-alive');
          res.write('event: message_start\n');
          res.write('data: {"type":"message_start","message":{"id":"msg_governance_review"}}\n\n');
          res.write('event: content_block_delta\n');
          res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: replyText } })}\n\n`);
          res.write('event: message_stop\n');
          res.write('data: {"type":"message_stop"}\n\n');
          res.end();
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          id: 'msg_governance_review',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: replyText }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 4 },
        }));
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function isTransientEndpointTrafficReadinessFailure(status: number, bodyText: string): boolean {
  if (status !== 400) {
    return false;
  }
  try {
    const body = JSON.parse(bodyText) as { error_code?: string; message?: string };
    return body.error_code === 'VALIDATION_ERROR' && body.message === 'fetch failed';
  } catch {
    return false;
  }
}

async function waitForEndpointTrafficReady(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  model: string;
  expectedReplyText: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  let lastFailure = 'endpoint_request_not_attempted';

  for (let attempt = 0; attempt < 45; attempt += 1) {
    const response = await args.page.request.post(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/endpoints/${args.endpointId}/proxy/anthropic/messages`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        data: {
          model: args.model,
          max_tokens: 64,
          messages: [{ role: 'user', content: [{ type: 'text', text: `Reply exactly: ${args.expectedReplyText}` }] }],
        },
      },
    );

    if (response.ok()) {
      await expect(response.text()).resolves.toContain(args.expectedReplyText);
      return;
    }

    const bodyText = await response.text();
    lastFailure = `${response.status()}:${bodyText}`;
    if (!isTransientEndpointTrafficReadinessFailure(response.status(), bodyText)) {
      throw new Error(`governance_review_endpoint_request_failed:${lastFailure}`);
    }
    await args.page.waitForTimeout(2_000);
  }

  throw new Error(`governance_review_endpoint_not_ready:${lastFailure}`);
}

async function waitForUsageFacts(args: {
  page: Page;
  workspaceId: string;
  projectId: string;
  endpointId: string;
}): Promise<void> {
  const token = await readStoredAuthToken(args.page);
  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const endTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await args.page.request.get(
      `${API_BASE}/api/v1/workspaces/${args.workspaceId}/projects/${args.projectId}/usage/facts?start_time=${encodeURIComponent(startTime)}&end_time=${encodeURIComponent(endTime)}&page=1&page_size=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (response.ok()) {
      const payload = (await response.json()) as {
        items?: Array<{ resource_id?: string; requests?: number }>;
      };
      const usageForEndpoint = (payload.items ?? []).find((item) => item.resource_id === args.endpointId);
      if ((usageForEndpoint?.requests ?? 0) > 0) {
        return;
      }
    }
    await args.page.waitForTimeout(2_000);
  }

  throw new Error('governance_review_usage_not_ready');
}

async function openAuditDetailFromFirstRow(page: Page): Promise<void> {
  const firstAuditAction = page.locator('[data-testid^="audit__row-actions--"]').first();
  await expect(firstAuditAction).toBeVisible({ timeout: 30_000 });
  const rowActionTestId = await firstAuditAction.getAttribute('data-testid');
  if (!rowActionTestId || !rowActionTestId.startsWith('audit__row-actions--')) {
    throw new Error(`governance_review_audit_action_missing_testid:${rowActionTestId ?? 'null'}`);
  }
  const rowId = rowActionTestId.replace('audit__row-actions--', '');
  await firstAuditAction.click();
  const viewDetails = page.getByTestId(`audit__view-details--${rowId}`);
  await expect(viewDetails).toBeVisible({ timeout: 30_000 });
  await viewDetails.click();
  await expect(page.getByTestId('audit__detail-summary')).toBeVisible({ timeout: 30_000 });
}

test.describe('@lane-real project owner daily governance review', () => {
  test('owner reviews usage, inspects audit detail, and adds alert follow-up from one governance flow', async ({ page }) => {
    test.setTimeout(600_000);
    const runtime = requireGovernanceReviewRuntime();
    const upstream = await startAnthropicCompatibleUpstream(runtime.expectedReplyText);
    const trace = await createUxTraceBundleWriter({
      outputRoot: process.env.UX_TRACE_OUTPUT_ROOT,
      lane: 'backend-real',
      suite: 'integration-project-owner-governance-review',
      storyId: GOVERNANCE_REVIEW_STORY.storyId,
      title: GOVERNANCE_REVIEW_STORY.title,
      actor: GOVERNANCE_REVIEW_STORY.actor,
      route: GOVERNANCE_REVIEW_STORY.entryRoute,
      specFile: 'e2e/integration-project-owner-governance-review.spec.ts',
      browser: 'chromium',
      goal: GOVERNANCE_REVIEW_STORY.goal,
      preconditions: [...(GOVERNANCE_REVIEW_STORY.preconditions ?? [])],
      seedData: [...(GOVERNANCE_REVIEW_STORY.seedData ?? [])],
      storyBinding: GOVERNANCE_REVIEW_BINDING,
    });
    let outcome: 'pass' | 'fail' = 'fail';

    try {
      await ensureIntegrationKeycloakUsers();
      await loginAsSystemAdminForGovernanceReview(page);
      const workspaceId = await createAndPublishWorkspaceForGovernanceReview(page);

      await keycloakLoginToWorkspace(
        page,
        workspaceId,
        KEYCLOAK_INTEGRATION_USER_USERNAME,
        KEYCLOAK_INTEGRATION_USER_PASSWORD,
        { ensureProjectCreatorAccess: false },
      );

      const { projectId } = await createProjectInWorkspace(page, workspaceId, runtime.projectNamePrefix, {
        visibility: 'private',
        joinPolicy: 'approval_required',
      });
      const credentialName = `${runtime.credentialNamePrefix} ${Date.now()}`;
      await createCredentialViaUi(page, workspaceId, projectId, credentialName, 'sk-owner-governance-review');
      const endpointName = `${runtime.endpointNamePrefix} ${Date.now()}`;
      const endpointId = await createEndpointViaApi(page, workspaceId, projectId, {
        endpointName,
        endpointModel: runtime.model,
        upstreamBaseUrl: upstream.baseUrl,
        credentialName,
        upstreamProtocol: 'anthropic_messages',
      });

      await waitForEndpointTrafficReady({
        page,
        workspaceId,
        projectId,
        endpointId,
        model: runtime.model,
        expectedReplyText: runtime.expectedReplyText,
      });

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/usage`);
      await expect(page.getByTestId('usage__work-surface')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('usage__summary-line')).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'open-usage-review' });

      await waitForUsageFacts({
        page,
        workspaceId,
        projectId,
        endpointId,
      });
      await expect(page.getByTestId('usage__selected-endpoint')).toHaveText(endpointName, { timeout: 30_000 });
      await expect(page.getByTestId('usage__limit-row').first()).toBeVisible({ timeout: 30_000 });
      await trace.capture(page, { stepId: 'inspect-runtime-usage' });

      await gotoWithRetry(page, `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/audit`);
      await expect(page.getByTestId('audit__page')).toBeVisible({ timeout: 30_000 });
      await openAuditDetailFromFirstRow(page);
      await trace.capture(page, { stepId: 'inspect-audit-detail' });

      const alertsPath = `/${LOCALE}/workspaces/${workspaceId}/projects/${projectId}/alerts`;
      await gotoWithRetry(page, alertsPath);
      await expect(page.getByTestId('alerts__main-surface')).toBeVisible({ timeout: 30_000 });
      const rulesTab = page.getByTestId('alerts__tab__rules');
      await expect(rulesTab).toBeVisible({ timeout: 30_000 });
      await rulesTab.click();
      await expect(page.getByTestId('alert-center__create-button')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('alert-rules-list__empty')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid^="alert-rule-row--"]')).toHaveCount(0);
      await trace.capture(page, { stepId: 'configure-alert-follow-up' });

      outcome = 'pass';
    } finally {
      await trace.finish({
        outcome,
        finishedAt: new Date().toISOString(),
      });
      await upstream.stop();
    }
  });
});
